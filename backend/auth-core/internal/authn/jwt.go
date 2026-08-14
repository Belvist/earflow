package authn

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// AccessClaims mirrors the Node access token payload:
// { type:"access", userId, sid, ts, isAdmin }.
type AccessClaims struct {
	Type    string `json:"type"`
	UserID  int64  `json:"userId"`
	SID     string `json:"sid"`
	TS      int64  `json:"ts"`
	IsAdmin bool   `json:"isAdmin"`
	jwt.RegisteredClaims
}

// RefreshClaims mirrors the Node refresh token payload:
// { type:"refresh", userId, sid, jti, ts }.
type RefreshClaims struct {
	Type   string `json:"type"`
	UserID int64  `json:"userId"`
	SID    string `json:"sid"`
	JTI    string `json:"jti"`
	TS     int64  `json:"ts"`
	jwt.RegisteredClaims
}

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrExpiredToken = errors.New("expired token")
)

// IssueAccessToken signs an HS256 access token with Node-compatible claims.
func IssueAccessToken(secret []byte, issuer, audience string, ttl time.Duration, userID int64, sid string, isAdmin bool) (string, error) {
	claims := AccessClaims{
		Type:    "access",
		UserID:  userID,
		SID:     sid,
		TS:      time.Now().UnixMilli(),
		IsAdmin: isAdmin,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   idString(userID),
			Audience:  jwt.ClaimStrings{audience},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
}

// IssueRefreshToken signs an HS256 refresh token with Node-compatible claims.
func IssueRefreshToken(secret []byte, issuer, audience string, ttl time.Duration, userID int64, sid, jti string) (string, error) {
	claims := RefreshClaims{
		Type:   "refresh",
		UserID: userID,
		SID:    sid,
		JTI:    jti,
		TS:     time.Now().UnixMilli(),
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   idString(userID),
			Audience:  jwt.ClaimStrings{audience},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
}

// VerifyAccess validates an HS256 access token (issuer/audience enforced).
func VerifyAccess(secret []byte, issuer, audience, token string) (*AccessClaims, error) {
	claims := &AccessClaims{}
	if err := parse(secret, issuer, audience, token, claims); err != nil {
		return nil, err
	}
	return claims, nil
}

// VerifyRefresh validates an HS256 refresh token (issuer/audience enforced).
func VerifyRefresh(secret []byte, issuer, audience, token string) (*RefreshClaims, error) {
	claims := &RefreshClaims{}
	if err := parse(secret, issuer, audience, token, claims); err != nil {
		return nil, err
	}
	return claims, nil
}

func parse(secret []byte, issuer, audience, token string, claims jwt.Claims) error {
	opts := []jwt.ParserOption{
		jwt.WithValidMethods([]string{"HS256"}),
		jwt.WithExpirationRequired(),
	}
	if issuer != "" {
		opts = append(opts, jwt.WithIssuer(issuer))
	}
	if audience != "" {
		opts = append(opts, jwt.WithAudience(audience))
	}
	_, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		return secret, nil
	}, opts...)
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) || errors.Is(err, jwt.ErrTokenNotValidYet) {
			return ErrExpiredToken
		}
		return ErrInvalidToken
	}
	return nil
}

func idString(id int64) string {
	if id == 0 {
		return ""
	}
	return itoa(id)
}

func itoa(v int64) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	buf := [20]byte{}
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
