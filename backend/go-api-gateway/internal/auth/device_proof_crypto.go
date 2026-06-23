package auth

import (
	"crypto/ecdsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/asn1"
	"encoding/base64"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	deviceProofVersion       = "v1"
	deviceProofMaxSkew       = 60 * time.Second
	deviceProofNonceTTL      = 120 * time.Second
	authCodeDeviceProofReq   = "DEVICE_PROOF_REQUIRED"
	authCodeDeviceProofInv   = "DEVICE_PROOF_INVALID"
	authCodeDeviceProofExp   = "DEVICE_PROOF_EXPIRED"
	authCodeDeviceProofReplay = "DEVICE_PROOF_REPLAY"
	authCodeDeviceRevoked    = "DEVICE_REVOKED"
)

func sidHashForProof(secret, sid string) string {
	return hmacSHA256Base64URL(secret, sid)
}

func buildCanonicalProofString(method, path string, query url.Values, ts, nonce, sidHash string) string {
	return strings.Join([]string{
		deviceProofVersion,
		strings.ToUpper(strings.TrimSpace(method)),
		normalizeProofPath(path),
		normalizeProofQuery(query),
		strings.TrimSpace(ts),
		strings.TrimSpace(nonce),
		strings.TrimSpace(sidHash),
	}, "\n")
}

func normalizeProofPath(path string) string {
	p := strings.TrimSpace(path)
	if p == "" {
		return "/"
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return p
}

func normalizeProofQuery(query url.Values) string {
	if len(query) == 0 {
		return ""
	}
	keys := make([]string, 0, len(query))
	for k := range query {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		vals := query[k]
		sort.Strings(vals)
		for _, v := range vals {
			parts = append(parts, url.QueryEscape(k)+"="+url.QueryEscape(v))
		}
	}
	return strings.Join(parts, "&")
}

func parseECDSAPublicKeySPKI(spkiB64URL string) (*ecdsa.PublicKey, error) {
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(spkiB64URL))
	if err != nil {
		return nil, err
	}
	pubAny, err := x509.ParsePKIXPublicKey(raw)
	if err != nil {
		return nil, err
	}
	pub, ok := pubAny.(*ecdsa.PublicKey)
	if !ok || pub.Curve == nil {
		return nil, errors.New("not ecdsa public key")
	}
	return pub, nil
}

func decodeECDSAP256Signature(sig []byte) (*big.Int, *big.Int, bool) {
	// Web Crypto subtle.sign (Chrome, Playwright) returns IEEE P1363 R||S for P-256 (64 bytes).
	if len(sig) == 64 {
		r := new(big.Int).SetBytes(sig[:32])
		s := new(big.Int).SetBytes(sig[32:])
		return r, s, true
	}
	var asn1Sig struct {
		R, S *big.Int
	}
	if _, err := asn1.Unmarshal(sig, &asn1Sig); err != nil {
		return nil, nil, false
	}
	if asn1Sig.R == nil || asn1Sig.S == nil {
		return nil, nil, false
	}
	return asn1Sig.R, asn1Sig.S, true
}

func verifyECDSAP256Signature(pub *ecdsa.PublicKey, digest []byte, sigB64URL string) bool {
	sigRaw, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(sigB64URL))
	if err != nil {
		return false
	}
	r, s, ok := decodeECDSAP256Signature(sigRaw)
	if !ok {
		return false
	}
	return ecdsa.Verify(pub, digest, r, s)
}

func verifyDeviceProof(secret string, pubSPKI, method string, r *http.Request, tsHeader, nonce, proofB64URL, sid string) error {
	pub, err := parseECDSAPublicKeySPKI(pubSPKI)
	if err != nil {
		return fmt.Errorf("%w: %s", errDeviceProofInvalid, err.Error())
	}
	tsUnix, err := strconv.ParseInt(strings.TrimSpace(tsHeader), 10, 64)
	if err != nil || tsUnix <= 0 {
		return errDeviceProofExpired
	}
	now := time.Now().UTC()
	reqTime := time.Unix(tsUnix, 0).UTC()
	skew := now.Sub(reqTime)
	if skew < 0 {
		skew = -skew
	}
	if skew > deviceProofMaxSkew {
		return errDeviceProofExpired
	}
	if strings.TrimSpace(nonce) == "" || strings.TrimSpace(proofB64URL) == "" {
		return errDeviceProofRequired
	}

	canonical := buildCanonicalProofString(method, r.URL.Path, r.URL.Query(), tsHeader, nonce, sidHashForProof(secret, sid))
	digest := sha256.Sum256([]byte(canonical))
	sigRaw := strings.TrimSpace(proofB64URL)
	if !verifyECDSAP256Signature(pub, digest[:], sigRaw) {
		return errDeviceProofInvalid
	}
	return nil
}

var (
	errDeviceProofRequired = errors.New(authCodeDeviceProofReq)
	errDeviceProofInvalid  = errors.New(authCodeDeviceProofInv)
	errDeviceProofExpired  = errors.New(authCodeDeviceProofExp)
	errDeviceProofReplay   = errors.New(authCodeDeviceProofReplay)
	errDeviceRevoked       = errors.New(authCodeDeviceRevoked)
)

func deviceProofErrorCode(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	switch msg {
	case authCodeDeviceProofReq:
		return authCodeDeviceProofReq
	case authCodeDeviceProofInv:
		return authCodeDeviceProofInv
	case authCodeDeviceProofExp:
		return authCodeDeviceProofExp
	case authCodeDeviceProofReplay:
		return authCodeDeviceProofReplay
	case authCodeDeviceRevoked:
		return authCodeDeviceRevoked
	default:
		return authCodeDeviceProofInv
	}
}

func deviceProofHTTPStatus(code string) int {
	if code == authCodeDeviceProofReplay {
		return http.StatusForbidden
	}
	return http.StatusUnauthorized
}
