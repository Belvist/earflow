package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strings"
	"sync/atomic"
	"time"

	"github.com/earflow/music-platform/go-api-gateway/internal/auth"
	"github.com/earflow/music-platform/go-api-gateway/internal/config"
	"github.com/earflow/music-platform/go-api-gateway/internal/observability"
	"github.com/earflow/music-platform/go-api-gateway/internal/ratelimit"
	"github.com/earflow/music-platform/go-api-gateway/internal/streamaccess"
)

const (
	headerUserID      = "X-User-Id"
	headerUserIDLower = "x-user-id"

	headerUserName      = "X-User-Name"
	headerUserNameLower = "x-user-name"

	headerUserRole      = "X-User-Role"
	headerUserRoleLower = "x-user-role"

	headerServiceToken = "X-Service-Token"
	headerServiceName  = "X-Service-Name"
)

type ReverseProxy struct {
	cfg          RouteTableConfig
	metrics      *Metrics
	routes       []compiledRoute
	up           upstreamPicker
	transport    http.RoundTripper
	streamAccess *streamaccess.Checker
}

type compiledRoute struct {
	id       string
	methods  map[string]struct{}
	match    config.Match
	re       *regexp.Regexp
	upstream string
	rewrite  string
	policies config.Policies
	timeout  time.Duration
	proxy    *httputil.ReverseProxy
}

type upstreamCtxKey struct{}

type upstreamPicker struct {
	m map[string]*rr
}

type rr struct {
	urls []*url.URL
	idx  atomic.Uint64
}

func isUnsafeMethod(m string) bool {
	switch strings.ToUpper(strings.TrimSpace(m)) {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func normalizeTrustClass(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	if s == "" {
		return "public"
	}
	return s
}

func isAuthExchangePath(path string) bool {
	switch path {
	case "/api/auth/email/login", "/api/auth/email/register", "/api/auth/telegram/login", "/api/auth/reset-password":
		return true
	default:
		return false
	}
}

func isPlausibleWSTicket(raw string) bool {
	s := strings.TrimSpace(raw)
	if len(s) < 60 || len(s) > 4096 {
		return false
	}
	if s[0] == '.' || s[len(s)-1] == '.' {
		return false
	}
	if strings.Count(s, ".") != 2 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z':
		case c >= 'A' && c <= 'Z':
		case c >= '0' && c <= '9':
		case c == '-' || c == '_' || c == '.':
		default:
			return false
		}
	}
	return true
}

func (p *ReverseProxy) enforceTrustClass(w http.ResponseWriter, r *http.Request, route compiledRoute) bool {
	if !isUnsafeMethod(r.Method) {
		return true
	}
	if p.cfg.Sessions == nil {
		return true
	}

	switch normalizeTrustClass(route.policies.Class) {
	case "unsafe":
		if isAuthExchangePath(r.URL.Path) {
			return p.cfg.Sessions.EnforceOrigin(w, r)
		}
		return p.cfg.Sessions.EnforceCSRF(w, r)
	case "auth_only":
		return p.cfg.Sessions.EnforceOrigin(w, r)
	default:
		return true
	}
}

func NewReverseProxy(cfg RouteTableConfig) (*ReverseProxy, error) {
	p := &ReverseProxy{cfg: cfg, metrics: NewMetrics()}
	baseTransport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		ForceAttemptHTTP2:     false,
		MaxIdleConns:          200,
		MaxIdleConnsPerHost:   64,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		// 0: не рвать upgrade к device-sync, если 101/хиджер задержались; обычные API не держат
		// ответ без заголовков 30+ секунд в норме.
		ResponseHeaderTimeout: 0,
	}
	p.transport = observability.WrapRoundTripper(baseTransport)

	p.up.m = map[string]*rr{}
	add := func(name string, list []string) error {
		if len(list) == 0 {
			return errors.New("missing upstream " + name)
		}
		rr := &rr{urls: make([]*url.URL, 0, len(list))}
		for _, raw := range list {
			u, err := url.Parse(strings.TrimSpace(raw))
			if err != nil || u.Scheme == "" || u.Host == "" {
				return errors.New("invalid upstream url")
			}

			switch strings.ToLower(strings.TrimSpace(u.Scheme)) {
			case "ws":
				u.Scheme = "http"
			case "wss":
				u.Scheme = "https"
			}
			rr.urls = append(rr.urls, u)
		}
		p.up.m[name] = rr
		return nil
	}

	if err := add("auth", cfg.Upstreams.Auth); err != nil {
		return nil, err
	}
	if err := add("upload", cfg.Upstreams.Upload); err != nil {
		return nil, err
	}
	if err := add("database", cfg.Upstreams.Database); err != nil {
		return nil, err
	}
	if err := add("recommendations", cfg.Upstreams.Recommendations); err != nil {
		return nil, err
	}
	if err := add("playlist", cfg.Upstreams.Playlist); err != nil {
		return nil, err
	}
	if err := add("subscription", cfg.Upstreams.Subscription); err != nil {
		return nil, err
	}
	if err := add("lyrics", cfg.Upstreams.Lyrics); err != nil {
		return nil, err
	}
	if err := add("party", cfg.Upstreams.Party); err != nil {
		return nil, err
	}
	if err := add("party_v2_state", cfg.Upstreams.PartyV2State); err != nil {
		return nil, err
	}
	if err := add("party_v2_gateway", cfg.Upstreams.PartyV2Gateway); err != nil {
		return nil, err
	}
	if len(cfg.Upstreams.Ebap) > 0 {
		if err := add("ebap", cfg.Upstreams.Ebap); err != nil {
			return nil, err
		}
	}
	if err := add("ebap_hls_adapter", cfg.Upstreams.EbapHlsAdapter); err != nil {
		return nil, err
	}
	if err := add("direct_stream", cfg.Upstreams.DirectStream); err != nil {
		return nil, err
	}
	if err := add("artist", cfg.Upstreams.Artist); err != nil {
		return nil, err
	}
	if err := add("artist_portal", cfg.Upstreams.ArtistPortal); err != nil {
		return nil, err
	}
	if err := add("search", cfg.Upstreams.Search); err != nil {
		return nil, err
	}
	if err := add("metadata_parser", cfg.Upstreams.MetadataParser); err != nil {
		return nil, err
	}
	if err := add("device_sync", cfg.Upstreams.DeviceSync); err != nil {
		return nil, err
	}
	if err := add("import_service", cfg.Upstreams.ImportService); err != nil {
		return nil, err
	}
	if err := add("security", cfg.Upstreams.Security); err != nil {
		return nil, err
	}

	if len(cfg.Upstreams.Database) == 0 {
		return nil, errors.New("missing upstream database")
	}
	checker, err := streamaccess.NewChecker(cfg.Upstreams.Database[0], cfg.ServiceTokens)
	if err != nil {
		return nil, err
	}
	p.streamAccess = checker

	p.routes = make([]compiledRoute, 0, len(cfg.Gateway.Routes))
	for _, r := range cfg.Gateway.Routes {
		cr, err := compileRoute(r)
		if err != nil {
			return nil, err
		}
		cr.proxy = p.newRouteProxy(cr)
		p.routes = append(p.routes, cr)
	}

	return p, nil
}

type hlsSessionReq struct {
	TrackID int `json:"trackId"`
}

func writeJSONError(w http.ResponseWriter, status int, msg string, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg, "code": code})
}

func (p *ReverseProxy) enforceHlsSessionAccess(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodPost {
		return true
	}
	if r.URL.Path != "/api/ebap-hls/v1/session" {
		return true
	}
	if p.streamAccess == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "Service temporarily unavailable", "SERVICE_UNAVAILABLE")
		return false
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 16*1024))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid JSON", "INVALID_JSON")
		return false
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	r.ContentLength = int64(len(body))

	var payload hlsSessionReq
	if err := json.Unmarshal(body, &payload); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid JSON", "INVALID_JSON")
		return false
	}

	if payload.TrackID <= 0 {
		writeJSONError(w, http.StatusBadRequest, "Invalid TrackID", "INVALID_TRACK_ID")
		return false
	}

	uid := strings.TrimSpace(r.Header.Get(headerUserID))
	isAdmin := auth.IsAdmin(r.Context())
	dec := p.streamAccess.CheckHlsSessionAccess(r.Context(), uid, isAdmin, payload.TrackID)
	if dec.Allowed {
		return true
	}
	writeJSONError(w, dec.Status, dec.Error, dec.Code)
	return false
}

func compileRoute(r config.Route) (compiledRoute, error) {
	methods := map[string]struct{}{}
	for _, m := range r.Methods {
		mm := strings.ToUpper(strings.TrimSpace(m))
		if mm == "" {
			continue
		}
		methods[mm] = struct{}{}
	}

	cr := compiledRoute{
		id:       r.ID,
		methods:  methods,
		match:    r.Match,
		upstream: r.Upstream,
		rewrite:  r.Rewrite,
		policies: r.Policies,
	}

	if raw := strings.TrimSpace(r.Policies.Timeout); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil || d <= 0 {
			return compiledRoute{}, errors.New("invalid route timeout for " + r.ID)
		}
		cr.timeout = d
	}

	if strings.ToLower(string(r.Match.Type)) == "regex" {
		re, err := regexp.Compile(r.Match.Value)
		if err != nil {
			return compiledRoute{}, err
		}
		cr.re = re
	}
	return cr, nil
}

func (p *ReverseProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	route, ok := p.match(r)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"Not found"}`))
		return
	}

	rec := newStatusRecorder(w)
	uid := strings.TrimSpace(r.Header.Get(headerUserID))
	p.metrics.Begin(route.id, route.upstream, r.Method, uid)
	defer p.metrics.End(route.id, route.upstream, r.Method, start, rec)
	serve := func(next http.Handler) {
		p.serveWithCache(route, p.serveWithRouteTimeout(route, next)).ServeHTTP(rec, r)
		p.invalidateCacheAfter(route, r, rec.Status())
	}

	if !p.enforceTrustClass(rec, r, route) {
		return
	}

	if !p.enforceHlsSessionAccess(rec, r) {
		return
	}

	if route.policies.RequireUser {
		uid := strings.TrimSpace(r.Header.Get(headerUserID))
		if uid == "" && route.id == "party_v2_ws" && route.policies.WebSocket {
			if claims, ok := authorizePartyWebSocketRequest(r); ok {
				uid = claims.UserID
			}
		}
		if uid == "" {
			if route.policies.WebSocket && isPlausibleWSTicket(r.URL.Query().Get("ticket")) {
				base := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					up, err := p.pick(route.upstream)
					if err != nil {
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusServiceUnavailable)
						_, _ = w.Write([]byte(`{"error":"Service temporarily unavailable","code":"SERVICE_UNAVAILABLE"}`))
						return
					}
					ctx := context.WithValue(r.Context(), upstreamCtxKey{}, up)
					route.proxy.ServeHTTP(w, r.WithContext(ctx))
				})

				if route.policies.RateLimit != "" {
					profile, ok := ratelimit.ProfileByName(route.policies.RateLimit, p.cfg.IsProduction)
					if ok {
						mw := p.cfg.Limiter.Middleware(route.id, profile, nil)
						serve(mw(base))
						return
					}
				}
				serve(base)
				return
			}

			rec.Header().Set("Content-Type", "application/json")
			rec.WriteHeader(http.StatusUnauthorized)
			_, _ = rec.Write([]byte(`{"error":"Authentication required","code":"NO_SESSION"}`))
			return
		}
	}

	if route.policies.RequireServiceToken {
		tok, err := p.cfg.ServiceTokens.GetToken(r.Context())
		if err != nil || tok == "" {
			rec.Header().Set("Content-Type", "application/json")
			rec.WriteHeader(http.StatusServiceUnavailable)
			_, _ = rec.Write([]byte(`{"error":"Service temporarily unavailable","code":"SERVICE_TOKEN_UNAVAILABLE"}`))
			return
		}
		r.Header.Set("X-Service-Token", tok)
		r.Header.Set("x-service-token", tok)
	}

	base := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		up, err := p.pick(route.upstream)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"error":"Service temporarily unavailable","code":"SERVICE_UNAVAILABLE"}`))
			return
		}
		ctx := context.WithValue(r.Context(), upstreamCtxKey{}, up)
		route.proxy.ServeHTTP(w, r.WithContext(ctx))
	})

	if route.policies.RateLimit != "" {
		profile, ok := ratelimit.ProfileByName(route.policies.RateLimit, p.cfg.IsProduction)
		if ok {
			mw := p.cfg.Limiter.Middleware(route.id, profile, nil)
			serve(mw(base))
			return
		}
	}

	serve(base)
}

func (p *ReverseProxy) serveWithCache(route compiledRoute, next http.Handler) http.Handler {
	cache := p.cfg.ResponseCache
	if cache == nil || strings.TrimSpace(route.policies.ResponseCache) == "" || route.policies.WebSocket {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !cacheableRequest(route, r) {
			w.Header().Set(cacheHeaderName, "BYPASS")
			p.metrics.Cache(route.id, "BYPASS")
			next.ServeHTTP(w, r)
			return
		}

		ttl := responseCacheTTL(route.policies.ResponseCache)
		if ttl <= 0 {
			w.Header().Set(cacheHeaderName, "BYPASS")
			p.metrics.Cache(route.id, "BYPASS")
			next.ServeHTTP(w, r)
			return
		}

		key := cache.key(r.Context(), route, r)
		if cached, ok, err := cache.get(r.Context(), key); err == nil && ok {
			p.metrics.Cache(route.id, "HIT")
			writeCachedResponse(w, cached)
			return
		} else if err != nil {
			w.Header().Set(cacheHeaderName, "BYPASS")
			p.metrics.Cache(route.id, "BYPASS")
			next.ServeHTTP(w, r)
			return
		}

		w.Header().Set(cacheHeaderName, "MISS")
		p.metrics.Cache(route.id, "MISS")
		cw := newCacheCaptureWriter(w, cache.maxBytes)
		next.ServeHTTP(cw, r)

		if !cacheableResponse(cw.status, cw.Header(), cw.capturedLen(), cache.maxBytes) {
			return
		}

		_ = cache.set(r.Context(), key, cachedHTTPResponse{
			Status: cw.status,
			Header: cloneCacheHeaders(cw.Header()),
			Body:   append([]byte(nil), cw.body...),
		}, ttl)
	})
}

func (p *ReverseProxy) invalidateCacheAfter(route compiledRoute, r *http.Request, status int) {
	if p.cfg.ResponseCache == nil || len(route.policies.InvalidateCacheNamespaces) == 0 {
		return
	}
	if status < 200 || status >= 300 {
		return
	}
	if !isUnsafeMethod(r.Method) {
		return
	}
	p.cfg.ResponseCache.invalidate(r.Context(), route.policies.InvalidateCacheNamespaces)
}

func (p *ReverseProxy) serveWithRouteTimeout(route compiledRoute, next http.Handler) http.Handler {
	if route.timeout <= 0 || route.policies.WebSocket {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), route.timeout)
		defer cancel()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (p *ReverseProxy) newRouteProxy(route compiledRoute) *httputil.ReverseProxy {
	px := &httputil.ReverseProxy{}
	px.Transport = p.transport
	px.FlushInterval = 50 * time.Millisecond

	px.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		status := http.StatusBadGateway
		code := "SERVICE_UNAVAILABLE"
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(r.Context().Err(), context.DeadlineExceeded) {
			status = http.StatusGatewayTimeout
			code = "UPSTREAM_TIMEOUT"
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"error":"Service temporarily unavailable","code":"` + code + `"}`))
	}

	px.Director = func(req *http.Request) {
		origHost := req.Host
		v := req.Context().Value(upstreamCtxKey{})
		up, _ := v.(*url.URL)
		if up != nil {
			req.URL.Scheme = up.Scheme
			req.URL.Host = up.Host
			req.Host = up.Host
		}

		applyRewrite(req, route.rewrite)

		if route.policies.StripAuth {
			req.Header.Del("Authorization")
			req.Header.Del("Cookie")
			req.Header.Del(headerUserID)
			req.Header.Del(headerUserIDLower)
			req.Header.Del(headerUserName)
			req.Header.Del(headerUserNameLower)
			req.Header.Del(headerUserRole)
			req.Header.Del(headerUserRoleLower)
			req.Header.Del(headerServiceToken)
			req.Header.Del(headerServiceName)
		}

		proto := strings.TrimSpace(req.Header.Get("X-Forwarded-Proto"))
		if proto == "" {
			if req.TLS != nil {
				proto = "https"
			} else {
				proto = "http"
			}
		}
		req.Header.Set("X-Forwarded-Proto", proto)
		req.Header.Set("X-Forwarded-Host", origHost)

		// WebSocket: downstream (coder/websocket) сверяет Origin при upgrade.
		// Удаление Origin/Referer ломало handshake. Страхуем и по пути: любой
		// /ws/… даже если в yaml забыли websocket: true, и подставляем Origin из
		// Referer, если браузер внезапно не прислал Origin.
		preserveWSHeaders := route.policies.WebSocket || strings.HasPrefix(req.URL.Path, "/ws/")
		if preserveWSHeaders {
			if strings.TrimSpace(req.Header.Get("Origin")) == "" {
				if ref := strings.TrimSpace(req.Header.Get("Referer")); ref != "" {
					if u, err := url.Parse(ref); err == nil && u.Scheme != "" && u.Host != "" {
						req.Header.Set("Origin", u.Scheme+"://"+u.Host)
					}
				}
			}
		} else {
			req.Header.Del("Origin")
			req.Header.Del("Referer")
		}

		if uid := strings.TrimSpace(req.Header.Get(headerUserID)); uid != "" {
			req.Header.Set(headerUserID, uid)
			req.Header.Set(headerUserIDLower, uid)
		}
		if uname := strings.TrimSpace(req.Header.Get(headerUserName)); uname != "" {
			req.Header.Set(headerUserName, uname)
			req.Header.Set(headerUserNameLower, uname)
		}
		if role := strings.TrimSpace(req.Header.Get(headerUserRole)); role != "" {
			req.Header.Set(headerUserRole, role)
		}
	}

	px.ModifyResponse = func(resp *http.Response) error {
		resp.Header.Del("Access-Control-Allow-Origin")
		resp.Header.Del("Access-Control-Allow-Credentials")
		resp.Header.Del("Access-Control-Allow-Methods")
		resp.Header.Del("Access-Control-Allow-Headers")
		resp.Header.Del("Access-Control-Expose-Headers")
		resp.Header.Del("Access-Control-Max-Age")
		for k, v := range route.policies.SetResponseHeaders {
			resp.Header.Set(k, v)
		}
		if route.policies.WebSocket {
			resp.Header.Set("X-Accel-Buffering", "no")
		} else if resp.Request != nil && strings.HasPrefix(resp.Request.URL.Path, "/ws/") {
			// согласовано с director: /ws/ без флага в yaml всё ещё long-lived stream
			resp.Header.Set("X-Accel-Buffering", "no")
		}
		return nil
	}

	return px
}

func (p *ReverseProxy) match(r *http.Request) (compiledRoute, bool) {
	path := r.URL.Path
	method := strings.ToUpper(r.Method)

	bestScore := -1
	bestIdx := -1

	for i, route := range p.routes {
		if len(route.methods) > 0 {
			if _, ok := route.methods[method]; !ok {
				continue
			}
		}

		score := -1

		switch strings.ToLower(string(route.match.Type)) {
		case "exact":
			if path != route.match.Value {
				continue
			}
			score = 3_000_000_000
		case "prefix":
			vals := route.match.Values
			if len(vals) == 0 {
				vals = []string{route.match.Value}
			}
			matchedLen := -1
			for _, v := range vals {
				if v == "" {
					continue
				}
				if strings.HasPrefix(path, v) {
					if len(v) > matchedLen {
						matchedLen = len(v)
					}
				}
			}
			if matchedLen < 0 {
				continue
			}
			score = 2_000_000_000 + matchedLen
		case "regex":
			if route.re == nil || !route.re.MatchString(path) {
				continue
			}
			score = 1_000_000_000
		default:
			continue
		}

		if score > bestScore {
			bestScore = score
			bestIdx = i
		}
	}
	if bestIdx < 0 {
		return compiledRoute{}, false
	}
	return p.routes[bestIdx], true
}

func (p *ReverseProxy) pick(name string) (*url.URL, error) {
	rr, ok := p.up.m[name]
	if !ok || rr == nil || len(rr.urls) == 0 {
		return nil, errors.New("unknown upstream")
	}
	i := rr.idx.Add(1) - 1
	return rr.urls[int(i%uint64(len(rr.urls)))], nil
}

func applyRewrite(req *http.Request, rewrite string) {
	if rewrite == "" {
		return
	}
	path := req.URL.Path
	qs := ""
	if req.URL.RawQuery != "" {
		qs = "?" + req.URL.RawQuery
	}

	if rewrite == "auth_alias" {
		if path == "/api/auth/verify" {
			req.URL.Path = "/api/verify"
			req.URL.RawPath = ""
			return
		}
		if path == "/api/auth/profile" {
			req.URL.Path = "/api/profile"
			req.URL.RawPath = ""
			return
		}
		_ = qs
		return
	}

	if rewrite == "user_alias" {
		uid := strings.TrimSpace(req.Header.Get(headerUserID))
		if uid == "" {
			return
		}
		switch {
		case strings.HasPrefix(path, "/api/user/settings"):
			req.URL.Path = "/api/users/" + url.PathEscape(uid) + "/settings"
		case strings.HasPrefix(path, "/api/user/stats"):
			req.URL.Path = "/api/users/" + url.PathEscape(uid) + "/stats"
		case strings.HasPrefix(path, "/api/user/profile"):
			req.URL.Path = "/api/users/" + url.PathEscape(uid)
		}
	}
}
