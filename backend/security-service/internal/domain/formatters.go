package domain

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

var (
	ruMonthsShort = [...]string{"янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"}

	reOS      = regexp.MustCompile(`(?i)(windows nt|mac os x|iphone|ipad|android|linux|cros)`)
	reBrowser = regexp.MustCompile(`(?i)(yabrowser|samsungbrowser|edg|chrome|firefox|safari|opera)`)

	prettyOS = map[string]string{
		"windows nt": "Windows",
		"mac os x":   "macOS",
		"iphone":     "iPhone",
		"ipad":       "iPad",
		"android":    "Android",
		"linux":      "Linux",
		"cros":       "ChromeOS",
	}
	prettyBrowser = map[string]string{
		"chrome":         "Chrome",
		"firefox":        "Firefox",
		"safari":         "Safari",
		"edg":            "Edge",
		"opera":          "Opera",
		"yabrowser":      "Yandex",
		"samsungbrowser": "Samsung",
	}
)

// FormatDateShortRu renders "21 апр 2026" given any RFC3339 timestamp.
// Returns "" on failure.
func FormatDateShortRu(value string) string {
	if value == "" {
		return ""
	}
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return ""
	}
	month := int(t.UTC().Month()) - 1
	if month < 0 || month >= len(ruMonthsShort) {
		return ""
	}
	return fmt.Sprintf("%02d %s %d", t.UTC().Day(), ruMonthsShort[month], t.UTC().Year())
}

// FormatDateTimeShortRu renders "21 апр 2026, 14:30 UTC".
func FormatDateTimeShortRu(value string) string {
	if value == "" {
		return ""
	}
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%s, %02d:%02d UTC", FormatDateShortRu(value), t.UTC().Hour(), t.UTC().Minute())
}

// FormatRelativeRu renders a localized "N minutes ago" label.
func FormatRelativeRu(value string, now time.Time) string {
	if value == "" {
		return "давно"
	}
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return "давно"
	}
	diff := now.Sub(t)
	if diff < 0 {
		return "только что"
	}
	minutes := int(diff.Round(time.Minute) / time.Minute)
	if minutes < 1 {
		return "только что"
	}
	if minutes < 60 {
		if minutes == 1 {
			return "минуту назад"
		}
		return fmt.Sprintf("%d мин назад", minutes)
	}
	hours := int(diff.Round(time.Hour) / time.Hour)
	if hours < 24 {
		if hours == 1 {
			return "час назад"
		}
		return fmt.Sprintf("%d ч назад", hours)
	}
	days := int(diff.Round(time.Hour*24) / (time.Hour * 24))
	if days < 30 {
		if days == 1 {
			return "вчера"
		}
		return fmt.Sprintf("%d дн назад", days)
	}
	return FormatDateShortRu(value)
}

// FormatExpiresRu renders "истекает через N дн".
func FormatExpiresRu(seconds int64) string {
	if seconds <= 0 {
		return "истекает скоро"
	}
	days := seconds / 86400
	if days >= 30 {
		return fmt.Sprintf("истекает через %d дн", days)
	}
	if days >= 1 {
		if days == 1 {
			return "истекает завтра"
		}
		return fmt.Sprintf("истекает через %d дн", days)
	}
	hours := seconds / 3600
	if hours >= 1 {
		if hours == 1 {
			return "истекает через час"
		}
		return fmt.Sprintf("истекает через %d ч", hours)
	}
	return "истекает меньше чем через час"
}

// DetectDeviceType returns one of: mobile, tablet, desktop, unknown.
func DetectDeviceType(ua string) string {
	s := strings.ToLower(strings.TrimSpace(ua))
	if s == "" {
		return "unknown"
	}
	if strings.Contains(s, "iphone") || strings.Contains(s, "ipod") {
		return "mobile"
	}
	if strings.Contains(s, "ipad") {
		return "tablet"
	}
	if strings.Contains(s, "android") {
		if strings.Contains(s, "mobile") {
			return "mobile"
		}
		return "tablet"
	}
	if strings.Contains(s, "windows phone") || strings.Contains(s, "blackberry") {
		return "mobile"
	}
	if strings.Contains(s, "windows") ||
		strings.Contains(s, "macintosh") ||
		strings.Contains(s, "linux") ||
		strings.Contains(s, "cros") {
		return "desktop"
	}
	return "unknown"
}

// ShortUaLabel renders a short human label like "Chrome · Windows".
func ShortUaLabel(ua string) string {
	s := strings.TrimSpace(ua)
	if s == "" {
		return "Неизвестное устройство"
	}
	lower := strings.ToLower(s)
	os := firstMatchLower(reOS, lower)
	br := firstMatchLower(reBrowser, lower)

	pos := prettyOS[os]
	pbr := prettyBrowser[br]
	switch {
	case pos != "" && pbr != "":
		return pbr + " · " + pos
	case pbr != "":
		return pbr
	case pos != "":
		return pos
	default:
		if len(s) > 48 {
			return s[:45] + "..."
		}
		return s
	}
}

func firstMatchLower(re *regexp.Regexp, s string) string {
	loc := re.FindStringIndex(s)
	if loc == nil {
		return ""
	}
	return s[loc[0]:loc[1]]
}

// MaskIP returns an IPv4/IPv6 address with the last component masked.
func MaskIP(ip string) string {
	s := strings.TrimSpace(ip)
	if s == "" {
		return ""
	}
	if strings.Contains(s, ":") {
		parts := splitNonEmpty(s, ":")
		if len(parts) <= 2 {
			return s
		}
		return parts[0] + ":" + parts[1] + ":····"
	}
	parts := strings.Split(s, ".")
	if len(parts) == 4 {
		return parts[0] + "." + parts[1] + "." + parts[2] + ".···"
	}
	return s
}

func splitNonEmpty(s, sep string) []string {
	raw := strings.Split(s, sep)
	out := make([]string, 0, len(raw))
	for _, p := range raw {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// MaskEmail keeps first two local-part characters, masks the rest before @.
func MaskEmail(email string) string {
	s := strings.TrimSpace(email)
	if s == "" {
		return ""
	}
	at := strings.IndexByte(s, '@')
	if at <= 0 {
		return s
	}
	local := s[:at]
	domain := s[at+1:]
	if len(local) <= 2 {
		first := "*"
		if len(local) >= 1 {
			first = string(local[0])
		}
		return first + "***@" + domain
	}
	return local[:2] + strings.Repeat("*", maxInt(1, len(local)-2)) + "@" + domain
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
