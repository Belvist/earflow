package auth

import (
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

func extractJTIFromRefreshToken(refresh string) string {
	clean := strings.TrimSpace(refresh)
	if clean == "" {
		return ""
	}
	parser := jwt.NewParser(jwt.WithoutClaimsValidation())
	claims := jwt.MapClaims{}
	_, _, err := parser.ParseUnverified(clean, claims)
	if err != nil {
		return ""
	}
	if jti, ok := claims["jti"].(string); ok {
		return strings.TrimSpace(jti)
	}
	return ""
}
