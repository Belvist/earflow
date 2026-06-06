package proxy

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	cacheHeaderName = "X-Cache"
	cachePrefix     = "gw:resp:v1:"
	cacheNSPrefix   = "gw:resp:ns:"
)

type ResponseCache struct {
	rdb      *redis.Client
	maxBytes int64
}

type cachedHTTPResponse struct {
	Status int                 `json:"status"`
	Header map[string][]string `json:"header"`
	Body   []byte              `json:"body"`
}

func NewResponseCache(rdb *redis.Client) *ResponseCache {
	if rdb == nil {
		return nil
	}
	return &ResponseCache{rdb: rdb, maxBytes: 2 * 1024 * 1024}
}

func responseCacheTTL(profile string) time.Duration {
	switch strings.ToLower(strings.TrimSpace(profile)) {
	case "catalog_short":
		return 60 * time.Second
	case "catalog_medium":
		return 5 * time.Minute
	case "catalog_long":
		return 15 * time.Minute
	default:
		if d, err := time.ParseDuration(strings.TrimSpace(profile)); err == nil && d > 0 {
			return d
		}
		return 0
	}
}

func (c *ResponseCache) namespaceVersion(ctx context.Context, namespace string) string {
	ns := strings.TrimSpace(namespace)
	if c == nil || c.rdb == nil || ns == "" {
		return "0"
	}
	v, err := c.rdb.Get(ctx, cacheNSPrefix+ns).Result()
	if err != nil || strings.TrimSpace(v) == "" {
		return "0"
	}
	return v
}

func (c *ResponseCache) key(ctx context.Context, route compiledRoute, r *http.Request) string {
	namespace := strings.TrimSpace(route.policies.ResponseCacheNamespace)
	if namespace == "" {
		namespace = route.id
	}
	uid := strings.TrimSpace(r.Header.Get(headerUserID))
	seed := strings.Join([]string{
		strings.ToUpper(r.Method),
		route.id,
		namespace,
		c.namespaceVersion(ctx, namespace),
		r.URL.EscapedPath(),
		r.URL.RawQuery,
		uid,
		strings.TrimSpace(r.Header.Get("Accept")),
	}, "\n")
	sum := sha256.Sum256([]byte(seed))
	return cachePrefix + route.id + ":" + hex.EncodeToString(sum[:])
}

func (c *ResponseCache) get(ctx context.Context, key string) (cachedHTTPResponse, bool, error) {
	var out cachedHTTPResponse
	if c == nil || c.rdb == nil || strings.TrimSpace(key) == "" {
		return out, false, nil
	}
	raw, err := c.rdb.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return out, false, nil
	}
	if err != nil {
		return out, false, err
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return cachedHTTPResponse{}, false, err
	}
	return out, true, nil
}

func (c *ResponseCache) set(ctx context.Context, key string, resp cachedHTTPResponse, ttl time.Duration) error {
	if c == nil || c.rdb == nil || ttl <= 0 {
		return nil
	}
	raw, err := json.Marshal(resp)
	if err != nil {
		return err
	}
	return c.rdb.Set(ctx, key, raw, ttl).Err()
}

func (c *ResponseCache) invalidate(ctx context.Context, namespaces []string) {
	if c == nil || c.rdb == nil || len(namespaces) == 0 {
		return
	}
	for _, ns := range namespaces {
		ns = strings.TrimSpace(ns)
		if ns == "" {
			continue
		}
		_ = c.rdb.Incr(ctx, cacheNSPrefix+ns).Err()
	}
}

func cacheableRequest(route compiledRoute, r *http.Request) bool {
	if strings.TrimSpace(route.policies.ResponseCache) == "" {
		return false
	}
	if route.policies.WebSocket {
		return false
	}
	path := ""
	if r != nil && r.URL != nil {
		path = r.URL.Path
	}
	switch route.id {
	case "artists":
		if path == "/api/artists/me" || strings.HasPrefix(path, "/api/artists/claims") || strings.HasPrefix(path, "/api/artists/admin") {
			return false
		}
	case "albums":
		if path == "/api/albums/resolve" {
			return false
		}
	}
	return r.Method == http.MethodGet
}

func cacheableResponse(status int, header http.Header, bodyLen int64, maxBytes int64) bool {
	if status != http.StatusOK {
		return false
	}
	if bodyLen < 0 || bodyLen > maxBytes {
		return false
	}
	if len(header.Values("Set-Cookie")) > 0 {
		return false
	}
	cc := strings.ToLower(header.Get("Cache-Control"))
	if strings.Contains(cc, "no-store") || strings.Contains(cc, "private") || strings.Contains(cc, "no-cache") {
		return false
	}
	ct := strings.ToLower(header.Get("Content-Type"))
	return strings.Contains(ct, "application/json")
}

func cloneCacheHeaders(h http.Header) map[string][]string {
	out := make(map[string][]string, len(h))
	for k, values := range h {
		canonical := http.CanonicalHeaderKey(k)
		switch strings.ToLower(canonical) {
		case "set-cookie", "connection", "transfer-encoding", "content-length", strings.ToLower(cacheHeaderName):
			continue
		}
		cp := make([]string, 0, len(values))
		for _, v := range values {
			cp = append(cp, v)
		}
		out[canonical] = cp
	}
	return out
}

type cacheCaptureWriter struct {
	http.ResponseWriter
	status   int
	body     []byte
	maxBytes int64
	overflow bool
}

func newCacheCaptureWriter(w http.ResponseWriter, maxBytes int64) *cacheCaptureWriter {
	if maxBytes <= 0 {
		maxBytes = 2 * 1024 * 1024
	}
	return &cacheCaptureWriter{ResponseWriter: w, status: http.StatusOK, maxBytes: maxBytes}
}

func (w *cacheCaptureWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *cacheCaptureWriter) Write(p []byte) (int, error) {
	if !w.overflow {
		if int64(len(w.body)+len(p)) <= w.maxBytes {
			w.body = append(w.body, p...)
		} else {
			w.overflow = true
			w.body = nil
		}
	}
	return w.ResponseWriter.Write(p)
}

func (w *cacheCaptureWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *cacheCaptureWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("hijacker not supported")
	}
	return h.Hijack()
}

func (w *cacheCaptureWriter) capturedLen() int64 {
	if w.overflow {
		return w.maxBytes + 1
	}
	return int64(len(w.body))
}

func writeCachedResponse(w http.ResponseWriter, cached cachedHTTPResponse) {
	for k, values := range cached.Header {
		for _, v := range values {
			w.Header().Add(k, v)
		}
	}
	w.Header().Set(cacheHeaderName, "HIT")
	w.Header().Set("Content-Length", strconv.Itoa(len(cached.Body)))
	w.WriteHeader(cached.Status)
	_, _ = w.Write(cached.Body)
}
