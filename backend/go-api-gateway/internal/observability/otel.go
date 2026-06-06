package observability

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

type Config struct {
	ServiceName string
	Environment string
	ServiceVersion string
	InstanceID string
	OTLPEndpoint string
	Timeout time.Duration
}

type State struct {
	enabled bool
	shutdown func(context.Context) error
}

var global State

func Enabled() bool {
	return global.enabled
}

func Shutdown(ctx context.Context) error {
	if global.shutdown == nil {
		return nil
	}
	return global.shutdown(ctx)
}

func Init(ctx context.Context, cfg Config) error {
	if global.shutdown != nil {
		return nil
	}

	endpoint := strings.TrimSpace(cfg.OTLPEndpoint)
	if endpoint == "" {
		endpoint = strings.TrimSpace(os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"))
	}
	if endpoint == "" {
		global = State{enabled: false, shutdown: nil}
		return nil
	}

	hostport, insecure, err := normalizeOTLPEndpoint(endpoint)
	if err != nil {
		return err
	}

	clientOpts := []otlptracegrpc.Option{otlptracegrpc.WithEndpoint(hostport)}
	if insecure {
		clientOpts = append(clientOpts, otlptracegrpc.WithInsecure())
	}

	to := cfg.Timeout
	if to <= 0 {
		to = 7 * time.Second
	}
	ctxDial, cancel := context.WithTimeout(ctx, to)
	defer cancel()

	exp, err := otlptracegrpc.New(ctxDial, clientOpts...)
	if err != nil {
		return err
	}

	rsAttrs := []attribute.KeyValue{
		semconv.ServiceNameKey.String(strings.TrimSpace(cfg.ServiceName)),
		semconv.DeploymentEnvironmentKey.String(strings.TrimSpace(cfg.Environment)),
	}
	if v := strings.TrimSpace(cfg.ServiceVersion); v != "" {
		rsAttrs = append(rsAttrs, semconv.ServiceVersionKey.String(v))
	}
	if v := strings.TrimSpace(cfg.InstanceID); v != "" {
		rsAttrs = append(rsAttrs, attribute.String("service.instance.id", v))
	}

	rs, err := resource.New(ctx, resource.WithAttributes(rsAttrs...))
	if err != nil {
		return err
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp,
			sdktrace.WithMaxQueueSize(4096),
			sdktrace.WithMaxExportBatchSize(512),
			sdktrace.WithBatchTimeout(5*time.Second),
		),
		sdktrace.WithResource(rs),
		sdktrace.WithSampler(readSamplerFromEnvOrDefault()),
	)

	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	global = State{enabled: true, shutdown: tp.Shutdown}
	return nil
}

func normalizeOTLPEndpoint(raw string) (hostport string, insecure bool, err error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", false, errors.New("empty OTLP endpoint")
	}

	if strings.Contains(s, "://") {
		u, parseErr := url.Parse(s)
		if parseErr != nil {
			return "", false, parseErr
		}
		if strings.TrimSpace(u.Host) == "" {
			return "", false, errors.New("invalid OTLP endpoint host")
		}
		insecure = u.Scheme != "https"
		return u.Host, insecure, nil
	}

	insecure = true
	return s, insecure, nil
}

func readSamplerFromEnvOrDefault() sdktrace.Sampler {
	name := strings.ToLower(strings.TrimSpace(os.Getenv("OTEL_TRACES_SAMPLER")))
	arg := strings.TrimSpace(os.Getenv("OTEL_TRACES_SAMPLER_ARG"))

	defaultRatio := 0.2
	if name == "" {
		return sdktrace.ParentBased(sdktrace.TraceIDRatioBased(defaultRatio))
	}

	ratio, ratioErr := parseRatio(arg, defaultRatio)
	if ratioErr != nil {
		return sdktrace.ParentBased(sdktrace.TraceIDRatioBased(defaultRatio))
	}

	switch name {
	case "always_on":
		return sdktrace.AlwaysSample()
	case "always_off":
		return sdktrace.NeverSample()
	case "traceidratio":
		return sdktrace.TraceIDRatioBased(ratio)
	case "parentbased_traceidratio":
		return sdktrace.ParentBased(sdktrace.TraceIDRatioBased(ratio))
	case "parentbased_always_on":
		return sdktrace.ParentBased(sdktrace.AlwaysSample())
	case "parentbased_always_off":
		return sdktrace.ParentBased(sdktrace.NeverSample())
	default:
		return sdktrace.ParentBased(sdktrace.TraceIDRatioBased(defaultRatio))
	}
}

func parseRatio(raw string, def float64) (float64, error) {
	if strings.TrimSpace(raw) == "" {
		return def, nil
	}
	f, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, err
	}
	if f < 0 || f > 1 {
		return 0, fmt.Errorf("ratio out of range")
	}
	return f, nil
}
