package auth

import (
	"net/http"
	"strings"
	"time"

	"github.com/earflow/music-platform/go-api-gateway/internal/config"
)

func GetCookie(r *http.Request, name string) string {
	if r == nil {
		return ""
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}

	var last string
	for _, header := range r.Header.Values("Cookie") {
		for _, part := range strings.Split(header, ";") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			kv := strings.SplitN(part, "=", 2)
			if len(kv) != 2 {
				continue
			}
			k := strings.TrimSpace(kv[0])
			if k != name {
				continue
			}
			v := strings.TrimSpace(kv[1])
			if len(v) >= 2 && v[0] == '"' && v[len(v)-1] == '"' {
				v = strings.Trim(v, "\"")
			}
			if v == "" {
				continue
			}
			last = v
		}
	}
	if last != "" {
		return last
	}

	c, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(c.Value)
}

func ClearSessionCookies(w http.ResponseWriter, cookie config.CookieConfig, names config.CookieNamesConfig) {
	clearCookie(w, names.Auth, true, cookie)
	clearCookie(w, names.Refresh, true, cookie)
	clearCookie(w, names.SID, true, cookie)
	clearCookie(w, names.CSRF, false, cookie)

	altSID := altCookieName(names.SID)
	if altSID != "" {
		clearCookie(w, altSID, true, cookie)
	}
	altCSRF := altCookieName(names.CSRF)
	if altCSRF != "" {
		clearCookie(w, altCSRF, false, cookie)
	}
}

func SetSessionCookies(w http.ResponseWriter, cookie config.CookieConfig, names config.CookieNamesConfig, sid string, csrfToken string, maxAgeSeconds int) {
	ClearSessionCookies(w, cookie, names)

	maxAge := maxAgeSeconds
	setCookie(w, names.SID, sid, true, cookie, maxAge)
	setCookie(w, names.CSRF, csrfToken, false, cookie, maxAge)
}

func clearCookie(w http.ResponseWriter, name string, httpOnly bool, cookie config.CookieConfig) {
	base := http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: httpOnly,
		Secure:   cookie.Secure,
		SameSite: sameSite(cookie.SameSite),
	}
	variants := []string{"", strings.TrimPrefix(strings.TrimSpace(cookie.Domain), "."), strings.TrimSpace(cookie.Domain)}
	seen := map[string]struct{}{}
	for _, d := range variants {
		d = strings.TrimSpace(d)
		if _, ok := seen[d]; ok {
			continue
		}
		seen[d] = struct{}{}
		c := base
		if d != "" {
			c.Domain = d
		}
		http.SetCookie(w, &c)
	}
}

func setCookie(w http.ResponseWriter, name string, value string, httpOnly bool, cookie config.CookieConfig, maxAgeSeconds int) {
	c := http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAgeSeconds,
		Expires:  time.Now().Add(time.Duration(maxAgeSeconds) * time.Second),
		HttpOnly: httpOnly,
		Secure:   cookie.Secure,
		SameSite: sameSite(cookie.SameSite),
	}
	d := strings.TrimSpace(cookie.Domain)
	if d != "" {
		c.Domain = d
	}
	http.SetCookie(w, &c)
}

func sameSite(raw string) http.SameSite {
	s := strings.ToLower(strings.TrimSpace(raw))
	switch s {
	case "none":
		return http.SameSiteNoneMode
	case "strict":
		return http.SameSiteStrictMode
	default:
		return http.SameSiteLaxMode
	}
}
