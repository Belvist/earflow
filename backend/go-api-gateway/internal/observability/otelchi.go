package observability

import (
	"net/http"
)

func ChiMiddleware(serviceName string) func(http.Handler) http.Handler {
	_ = serviceName
	return func(next http.Handler) http.Handler { return next }
}
