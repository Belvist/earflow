package auth

import "regexp"

var sidRe = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

func IsValidSID(sid string) bool {
	if sid == "" {
		return false
	}
	if len(sid) < 20 || len(sid) > 128 {
		return false
	}
	return sidRe.MatchString(sid)
}
