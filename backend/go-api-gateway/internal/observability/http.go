package observability

import (
	"bufio"
	"errors"
	"fmt"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

var ebapV3ChunkRe = regexp.MustCompile(`^/api/ebap/v3/chunk/(\d{1,10})/(\d{1,10})$`)
var ebapV3ReadinessRe = regexp.MustCompile(`^/api/ebap/v3/readiness/(\d{1,10})$`)

func WrapRoundTripper(rt http.RoundTripper) http.RoundTripper {
	if rt == nil {
		return nil
	}
	if !Enabled() {
		return rt
	}
	return &safeRoundTripper{base: rt}
}

func Middleware() func(http.Handler) http.Handler {
	if !Enabled() {
		return func(next http.Handler) http.Handler { return next }
	}
	tr := otel.Tracer("earflow.gateway")
	prop := otel.GetTextMapPropagator()
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := prop.Extract(r.Context(), propagation.HeaderCarrier(r.Header))
			ctx, span := tr.Start(ctx, r.Method+" "+safeSpanPath(r), trace.WithSpanKind(trace.SpanKindServer))
			defer span.End()
			r = r.WithContext(ctx)
			rw := &statusCapturingResponseWriter{ResponseWriter: w, status: 0}

			attrs := make([]attribute.KeyValue, 0, 8)
			attrs = append(attrs,
				semconv.HTTPRequestMethodKey.String(r.Method),
				semconv.URLPathKey.String(r.URL.Path),
				semconv.URLQueryKey.String(""),
			)
			if cid := strings.TrimSpace(r.Header.Get("X-Correlation-Id")); cid != "" {
				attrs = append(attrs, attribute.String("earflow.correlation_id", cid))
			}
			if uid := strings.TrimSpace(r.Header.Get("X-User-Id")); uid != "" {
				attrs = append(attrs, attribute.Bool("enduser.authenticated", true))
			}
			if role := strings.TrimSpace(r.Header.Get("X-User-Role")); role != "" {
				attrs = append(attrs, attribute.String("enduser.role", role))
			}

			p := r.URL.Path
			if m := ebapV3ChunkRe.FindStringSubmatch(p); len(m) == 3 {
				attrs = append(attrs,
					attribute.String("earflow.stream.protocol", "ebap"),
					attribute.Int("earflow.track.id", mustAtoi(m[1])),
					attribute.Int("earflow.chunk.index", mustAtoi(m[2])),
				)
			} else if m := ebapV3ReadinessRe.FindStringSubmatch(p); len(m) == 2 {
				attrs = append(attrs,
					attribute.String("earflow.stream.protocol", "ebap"),
					attribute.Int("earflow.track.id", mustAtoi(m[1])),
				)
			}

			if len(attrs) > 0 {
				span.SetAttributes(attrs...)
			}

			next.ServeHTTP(rw, r)
			status := rw.status
			if status == 0 {
				status = http.StatusOK
			}
			span.SetAttributes(semconv.HTTPResponseStatusCodeKey.Int(status))
			if status >= 500 {
				span.SetStatus(codes.Error, http.StatusText(status))
			}
		})
	}
}

type statusCapturingResponseWriter struct {
	http.ResponseWriter
	status int
}

var _ http.Hijacker = (*statusCapturingResponseWriter)(nil)
var _ http.Flusher = (*statusCapturingResponseWriter)(nil)

func (w *statusCapturingResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("hijacker not supported")
	}
	return h.Hijack()
}

func (w *statusCapturingResponseWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *statusCapturingResponseWriter) WriteHeader(statusCode int) {
	w.status = statusCode
	w.ResponseWriter.WriteHeader(statusCode)
}

type safeRoundTripper struct {
	base http.RoundTripper
}

func isWebSocketUpgrade(req *http.Request) bool {
	if req == nil {
		return false
	}
	up := strings.ToLower(strings.TrimSpace(req.Header.Get("Upgrade")))
	if up != "websocket" {
		return false
	}
	c := strings.ToLower(req.Header.Get("Connection"))
	return strings.Contains(c, "upgrade")
}

func (t *safeRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	if req == nil {
		return nil, errors.New("nil request")
	}
	ctx := req.Context()
	tr := otel.Tracer("earflow.gateway")

	spanName := req.Method + " " + safeClientSpanPath(req)
	ctx, span := tr.Start(ctx, spanName, trace.WithSpanKind(trace.SpanKindClient))
	defer span.End()

	span.SetAttributes(
		semconv.HTTPRequestMethodKey.String(req.Method),
		semconv.URLSchemeKey.String(req.URL.Scheme),
		semconv.ServerAddressKey.String(req.URL.Hostname()),
		semconv.URLPathKey.String(req.URL.Path),
		semconv.URLQueryKey.String(""),
	)

	if isWebSocketUpgrade(req) {
		resp, err := t.base.RoundTrip(req.WithContext(ctx))
		if err != nil {
			span.SetAttributes(attribute.String("error.type", fmt.Sprintf("%T", err)))
			span.SetStatus(codes.Error, "request failed")
			return nil, err
		}
		span.SetAttributes(semconv.HTTPResponseStatusCodeKey.Int(resp.StatusCode))
		if resp.StatusCode >= 500 {
			span.SetStatus(codes.Error, http.StatusText(resp.StatusCode))
		}
		return resp, nil
	}

	clone := req.Clone(ctx)
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(clone.Header))

	resp, err := t.base.RoundTrip(clone)
	if err != nil {
		span.SetAttributes(attribute.String("error.type", fmt.Sprintf("%T", err)))
		span.SetStatus(codes.Error, "request failed")
		return nil, err
	}
	span.SetAttributes(semconv.HTTPResponseStatusCodeKey.Int(resp.StatusCode))
	if resp.StatusCode >= 500 {
		span.SetStatus(codes.Error, http.StatusText(resp.StatusCode))
	}
	return resp, nil
}

func safeSpanPath(r *http.Request) string {
	if r == nil || r.URL == nil {
		return "/"
	}
	if p := strings.TrimSpace(r.URL.Path); p != "" {
		return p
	}
	return "/"
}

func safeClientSpanPath(r *http.Request) string {
	if r == nil || r.URL == nil {
		return "/"
	}
	if p := strings.TrimSpace(r.URL.Path); p != "" {
		return p
	}
	return "/"
}

func mustAtoi(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	if n < 0 {
		return 0
	}
	return n
}
