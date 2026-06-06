package proxy

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/earflow/music-platform/go-api-gateway/internal/auth"
	"github.com/earflow/music-platform/go-api-gateway/internal/config"
	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/bcrypt"
)

type Admin struct {
	metrics *Metrics
	auth    config.AdminAuthConfig
}

func NewAdmin(_ *auth.SessionManager, metrics *Metrics, authCfg config.AdminAuthConfig) *Admin {
	return &Admin{metrics: metrics, auth: authCfg}
}

func (a *Admin) Handler() http.Handler {
	r := chi.NewRouter()

	if a.auth.Username != "" {
		r.Use(AdminAuthMiddleware(a.auth))
	} else {
		r.Use(a.requireAdmin)
	}

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(adminHTML))
	})

	r.Get("/api/summary", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ts":     time.Now().UTC().Format(time.RFC3339),
			"routes": a.metrics.Snapshot(),
		})
	})

	return r
}

func (a *Admin) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !auth.IsAdmin(r.Context()) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":"Forbidden","code":"FORBIDDEN"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func AdminAuthMiddleware(cfg config.AdminAuthConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if cfg.Username == "" {
				next.ServeHTTP(w, r)
				return
			}
			user, pass, ok := r.BasicAuth()
			if !ok || subtle.ConstantTimeCompare([]byte(user), []byte(cfg.Username)) != 1 {
				denyBasic(w)
				return
			}
			if cfg.Password != "" {
				if subtle.ConstantTimeCompare([]byte(pass), []byte(cfg.Password)) != 1 {
					denyBasic(w)
					return
				}
				next.ServeHTTP(w, r)
				return
			}
			if err := bcrypt.CompareHashAndPassword([]byte(cfg.PasswordBcrypt), []byte(pass)); err != nil {
				if strings.HasPrefix(cfg.PasswordBcrypt, "$2y$") {
					normalized := "$2a$" + cfg.PasswordBcrypt[len("$2y$"):]
					if err2 := bcrypt.CompareHashAndPassword([]byte(normalized), []byte(pass)); err2 == nil {
						next.ServeHTTP(w, r)
						return
					}
				}
				denyBasic(w)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func denyBasic(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", `Basic realm="Gateway", charset="UTF-8"`)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte("Unauthorized"))
}

const adminHTML = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Gateway Admin</title><style>body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto;max-width:1100px;margin:24px auto;padding:0 16px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #e5e7eb;padding:10px 8px;text-align:left}th{font-weight:600}code{background:#f3f4f6;padding:2px 6px;border-radius:6px}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}h1{font-size:20px;margin:0}</style></head><body><header><h1>Gateway Admin</h1><div><code>/admin/api/summary</code></div></header><div id=\"root\">Loading...</div><script>async function load(){const r=await fetch('/admin/api/summary',{credentials:'include'});const j=await r.json();const routes=j.routes||{};let html='<table><thead><tr><th>route</th><th>count</th><th>errors</th></tr></thead><tbody>';for(const k of Object.keys(routes).sort()){const v=routes[k];html+=`<tr><td>${k}</td><td>${v.Count||0}</td><td>${v.Errors||0}</td></tr>`;}html+='</tbody></table>';document.getElementById('root').innerHTML=html;}load();setInterval(load,2000);</script></body></html>"
