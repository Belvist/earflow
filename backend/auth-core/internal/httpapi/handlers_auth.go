package httpapi

import (
	"net/http"
	"strings"
)

func emailRegisterHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
			return
		}
		var req struct {
			Email     string `json:"email"`
			Password  string `json:"password"`
			FirstName string `json:"firstName"`
			Username  string `json:"username"`
		}
		if err := readJSON(r, d.Config.HTTP.MaxBodyBytes, &req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_BODY", "Invalid JSON")
			return
		}

		result, apiErr := d.Svc.RegisterEmail(r.Context(), req.Email, req.Password, req.FirstName, req.Username)
		if apiErr != nil {
			writeAPIError(w, apiErr)
			return
		}

		writeJSON(w, http.StatusCreated, map[string]any{
			"token":        result.Token,
			"refreshToken": result.RefreshToken,
			"user":         result.User,
		})
	}
}

func emailLoginHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
			return
		}
		var req struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := readJSON(r, d.Config.HTTP.MaxBodyBytes, &req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_BODY", "Invalid JSON")
			return
		}

		result, apiErr := d.Svc.LoginEmail(r.Context(), req.Email, req.Password)
		if apiErr != nil {
			writeAPIError(w, apiErr)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"token":        result.Token,
			"refreshToken": result.RefreshToken,
			"user":         result.User,
		})
	}
}

func telegramLoginHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
			return
		}
		raw := map[string]any{}
		if err := readJSON(r, d.Config.HTTP.MaxBodyBytes, &raw); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_BODY", "Invalid JSON")
			return
		}

		result, apiErr := d.Svc.LoginTelegram(r.Context(), raw)
		if apiErr != nil {
			writeAPIError(w, apiErr)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"token":        result.Token,
			"refreshToken": result.RefreshToken,
			"user":         result.User,
		})
	}
}

func refreshHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
			return
		}
		var req struct {
			RefreshToken string `json:"refreshToken"`
		}
		if err := readJSON(r, d.Config.HTTP.MaxBodyBytes, &req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_BODY", "Invalid JSON")
			return
		}

		result, apiErr := d.Svc.Refresh(r.Context(), req.RefreshToken)
		if apiErr != nil {
			writeAPIError(w, apiErr)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"accessToken":  result.AccessToken,
			"refreshToken": result.RefreshToken,
		})
	}
}

func verifyHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
			return
		}
		var req struct {
			Token string `json:"token"`
		}
		if err := readJSON(r, d.Config.HTTP.MaxBodyBytes, &req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_BODY", "Invalid JSON")
			return
		}

		result, apiErr := d.Svc.Verify(r.Context(), req.Token)
		if apiErr != nil {
			writeAPIError(w, apiErr)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{"valid": true, "user": result.User})
	}
}

func profileHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
			return
		}
		bust := r.URL.Query().Get("bustCache")
		bustLower := strings.ToLower(bust)
		bustCache := bustLower == "1" || bustLower == "true"

		profile, apiErr := d.Svc.Profile(r.Context(), r.Header.Get("Authorization"), bustCache)
		if apiErr != nil {
			writeAPIError(w, apiErr)
			return
		}
		writeJSON(w, http.StatusOK, profile)
	}
}
