package auth

import (
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

func extractJTIFromRefreshToken(refresh string) string {
	claims := parseRefreshTokenClaims(refresh)
	if jti, ok := claims["jti"].(string); ok {
		return strings.TrimSpace(jti)
	}
	return ""
}

// extractSIDFromRefreshToken returns the auth-service session id claim ("sid")
// embedded in the refresh token. Unlike the gateway sid, this is the id under
// which the auth-service keeps its own session keys (auth:sid, auth:session:meta).
func extractSIDFromRefreshToken(refresh string) string {
	claims := parseRefreshTokenClaims(refresh)
	if sid, ok := claims["sid"].(string); ok {
		return strings.TrimSpace(sid)
	}
	return ""
}

func parseRefreshTokenClaims(refresh string) jwt.MapClaims {
	clean := strings.TrimSpace(refresh)
	claims := jwt.MapClaims{}
	if clean == "" {
		return claims
	}
	parser := jwt.NewParser(jwt.WithoutClaimsValidation())
	if _, _, err := parser.ParseUnverified(clean, claims); err != nil {
		return jwt.MapClaims{}
	}
	return claims
}
