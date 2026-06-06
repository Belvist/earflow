package observability

import (
	"bufio"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

type hijackableResponseWriter struct {
	header http.Header
}

func (w *hijackableResponseWriter) Header() http.Header {
	if w.header == nil {
		w.header = make(http.Header)
	}
	return w.header
}

func (w *hijackableResponseWriter) Write(p []byte) (int, error) {
	return len(p), nil
}

func (w *hijackableResponseWriter) WriteHeader(statusCode int) {
	_ = statusCode
}

func (w *hijackableResponseWriter) Flush() {}

func (w *hijackableResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	server, client := net.Pipe()
	_ = client.Close()
	return server, bufio.NewReadWriter(bufio.NewReader(server), bufio.NewWriter(server)), nil
}

func TestMiddleware_PreservesHijackerAndFlusher(t *testing.T) {
	prev := global
	global.enabled = true
	defer func() { global = prev }()

	called := false
	h := Middleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		_ = r

		if _, ok := w.(http.Hijacker); !ok {
			t.Fatalf("expected ResponseWriter to implement http.Hijacker")
		}
		if _, ok := w.(http.Flusher); !ok {
			t.Fatalf("expected ResponseWriter to implement http.Flusher")
		}

		c, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Fatalf("hijack failed: %v", err)
		}
		_ = c.Close()
	}))

	req := httptest.NewRequest(http.MethodGet, "http://example.test/ws", nil)
	rw := &hijackableResponseWriter{}
	h.ServeHTTP(rw, req)

	if !called {
		t.Fatalf("expected handler to be called")
	}
}
