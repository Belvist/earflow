package searchwall

import (
	"net/url"
	"regexp"
	"unicode/utf8"
)

var validQueryRx = regexp.MustCompile(`^[\p{L}\p{N}\s\-\.\&\'!(),/:_+@#"]+$`)

func validateQuery(cfg Config, values url.Values) (string, bool) {
	if cfg.RequireSingleValueKeys {
		for _, k := range []string{"q", "limit", "offset"} {
			if len(values[k]) > 1 {
				return "", false
			}
		}
	}

	qs := values["q"]
	q := ""
	if len(qs) > 0 {
		q = qs[0]
	}

	if q == "" {
		return "", cfg.AllowEmptyQuery
	}

	maxRunes := cfg.MaxQueryRunes
	if maxRunes <= 0 {
		maxRunes = 80
	}
	if utf8.RuneCountInString(q) > maxRunes {
		return "", false
	}

	if !validQueryRx.MatchString(q) {
		return "", false
	}

	return q, true
}
