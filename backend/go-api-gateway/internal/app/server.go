package app

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/earflow/music-platform/go-api-gateway/internal/auth"
	"github.com/earflow/music-platform/go-api-gateway/internal/config"
	"github.com/earflow/music-platform/go-api-gateway/internal/httpx/middleware"
	"github.com/earflow/music-platform/go-api-gateway/internal/observability"
	"github.com/earflow/music-platform/go-api-gateway/internal/proxy"
	"github.com/earflow/music-platform/go-api-gateway/internal/ratelimit"
	"github.com/earflow/music-platform/go-api-gateway/internal/service"
	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"
)

func NewServerFromEnv(ctx context.Context) (*http.Server, error) {
	cfg, err := config.LoadFromEnv()
	if err != nil {
		return nil, err
	}

	if err := observability.Init(ctx, observability.Config{
		ServiceName:    cfg.ServiceName,
		Environment:    cfg.NodeEnv,
		ServiceVersion: cfg.AppVersion,
		InstanceID:     cfg.InstanceID,
	}); err != nil {
		return nil, err
	}

	redisAuth := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAuth.Addr,
		Password: cfg.RedisAuth.Password,
		DB:       cfg.RedisAuth.DB,
	})
	if err := redisAuth.Ping(ctx).Err(); err != nil {
		return nil, err
	}

	redisRateLimit := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisRateLimit.Addr,
		Password: cfg.RedisRateLimit.Password,
		DB:       cfg.RedisRateLimit.DB,
	})
	if err := redisRateLimit.Ping(ctx).Err(); err != nil {
		return nil, err
	}

	gatewayCfg, err := config.LoadGatewayYAML(cfg.GatewayConfigPath)
	if err != nil {
		return nil, err
	}

	serviceTokens := service.NewServiceTokenManager(service.TokenManagerConfig{
		ServiceName: cfg.ServiceName,
		ServiceKey:  cfg.ServiceKeyAPIGateway,
		Endpoint:    cfg.Upstreams.Database[0] + "/auth/service-token",
	})

	securityURL := ""
	if len(cfg.Upstreams.Security) > 0 {
		securityURL = cfg.Upstreams.Security[0]
	}
	sessions, err := auth.NewSessionManager(auth.SessionManagerConfig{
		Redis:                 redisAuth,
		JWTSecret:             cfg.JWTSecret,
		JWTIssuer:             cfg.JWTIssuer,
		JWTAudience:           cfg.JWTAudience,
		Cookie:                cfg.Cookie,
		CookieNames:           cfg.CookieNames,
		SessionTTL:            cfg.SessionTTL,
		AuthBaseURL:           cfg.Upstreams.Auth[0],
		SecurityBaseURL:       securityURL,
		ServiceKeyGateway:     cfg.ServiceKeyAPIGateway,
		TelegramBotUsername:   cfg.TelegramBotUsername,
		AllowedOrigins:        cfg.AllowedOrigins,
		IsProduction:          cfg.IsProduction,
		ClientErrorLogEnabled: cfg.ClientErrorLogEnabled,
	})
	if err != nil {
		return nil, err
	}
	sessions.StartRevokeSubscriber(ctx)

	limiter := ratelimit.NewLimiter(ratelimit.LimiterConfig{
		Redis:               redisRateLimit,
		IsProduction:        cfg.IsProduction,
		TrustProxy:          cfg.TrustProxy,
		RateLimitMultiplier: cfg.RateLimitMultiplier,
	})

	routeTable, err := proxy.NewRouteTable(proxy.RouteTableConfig{
		Gateway:           gatewayCfg,
		Upstreams:         cfg.Upstreams,
		ServiceTokens:     serviceTokens,
		Sessions:          sessions,
		Limiter:           limiter,
		ResponseCache:     proxy.NewResponseCache(redisRateLimit),
		IsProduction:      cfg.IsProduction,
		InstanceID:        cfg.InstanceID,
		NodeEnv:           cfg.NodeEnv,
		ServiceName:       cfg.ServiceName,
		GatewayConfigPath: cfg.GatewayConfigPath,
		AdminAuth:         cfg.AdminAuth,
	})
	if err != nil {
		return nil, err
	}

	r := chi.NewRouter()
	r.Use(middleware.Recover)
	r.Use(middleware.InternalHeaderSanitizer)
	r.Use(middleware.CorrelationID)
	r.Use(middleware.CORS(middleware.CORSConfig{AllowedOrigins: cfg.AllowedOrigins}))
	r.Use(middleware.SecurityHeaders)

	r.Use(limiter.GlobalMiddleware())
	r.Use(sessions.SessionAuthMiddleware())
	r.Use(sessions.DeviceProofMiddleware())
	r.Use(observability.Middleware())
	r.Use(limiter.UserMiddleware())
	r.Use(sessions.CSRFEnsureCookieMiddleware())

	sessions.MountRoutes(r)

	r.Mount("/", routeTable.Handler())

	// WebSocket: ReverseProxy удерживает «долгий» хендлер; ненулевой ReadTimeout/IdleTimeout
	// на Server закрывали wss (клиент — цикл ws-ticket). device-sync тоже держит Read/Write=0
	// для live-сокетов. Защита от тупняка по чтению: ReadHeaderTimeout + лимиты в сервисах.
	srv := &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.Port),
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       0,
		WriteTimeout:      0,
		IdleTimeout:       0,
	}
	return srv, nil
}
