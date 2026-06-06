package db

import (
	"encoding/json"
	"time"

	"reco-feedback-worker/internal/config"
)

type Interaction struct {
	UserID            int
	TrackID           int
	Action            string
	DurationMs        int
	Progress          *float64
	SessionID         *string
	EventID           string
	PlaybackSessionID *string
	SchemaVersion     int
	EventTime         time.Time
	Context           json.RawMessage

	DurationSeconds int
}

func Normalize(cfg config.Config, in map[string]any) (Interaction, bool) {
	uid := toInt(in["userId"])
	tid := toInt(in["trackId"])
	if uid <= 0 || tid <= 0 {
		return Interaction{}, false
	}
	action, ok := in["action"].(string)
	if !ok {
		return Interaction{}, false
	}
	action = stringsLowerTrim(action)
	if _, ok := cfg.Taste.AllowedActions[action]; !ok {
		return Interaction{}, false
	}

	durationMs := toInt(in["durationMs"])
	if durationMs < 0 {
		durationMs = 0
	}
	maxMs := int(cfg.Taste.MaxDuration / time.Millisecond)
	if durationMs > maxMs {
		durationMs = maxMs
	}
	durationSeconds := durationMs / 1000

	var progress *float64
	if v, ok := toFloatPtr(in["progress"]); ok {
		if *v >= 0 && *v <= 1 {
			progress = v
		}
	}

	eventID := stringsTrim(toString(in["eventId"]))
	if eventID == "" {
		eventID = ""
	}

	psid := stringsTrim(toString(in["playbackSessionId"]))
	var playbackSessionID *string
	if psid != "" {
		playbackSessionID = &psid
	}

	sid := stringsTrim(toString(in["sessionId"]))
	var sessionID *string
	if sid != "" {
		sessionID = &sid
	}

	schemaVersion := toInt(in["schemaVersion"])
	if schemaVersion <= 0 {
		schemaVersion = 1
	}

	eventTimeMs := toInt64(in["eventTime"])
	if eventTimeMs <= 0 {
		eventTimeMs = time.Now().UnixMilli()
	}
	eventTime := time.UnixMilli(eventTimeMs)

	var ctxRaw json.RawMessage
	if ctxObj, ok := in["context"].(map[string]any); ok {
		b, err := json.Marshal(ctxObj)
		if err == nil {
			ctxRaw = b
		}
	}

	return Interaction{
		UserID:            uid,
		TrackID:           tid,
		Action:            action,
		DurationMs:        durationMs,
		Progress:          progress,
		SessionID:         sessionID,
		EventID:           eventID,
		PlaybackSessionID: playbackSessionID,
		SchemaVersion:     schemaVersion,
		EventTime:         eventTime,
		Context:           ctxRaw,
		DurationSeconds:   durationSeconds,
	}, true
}

func stringsLowerTrim(s string) string {
	s = stringsTrim(s)
	b := []byte(s)
	for i := 0; i < len(b); i++ {
		c := b[i]
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}

func stringsTrim(s string) string {
	start := 0
	end := len(s)
	for start < end {
		c := s[start]
		if c != ' ' && c != '\n' && c != '\t' && c != '\r' {
			break
		}
		start++
	}
	for end > start {
		c := s[end-1]
		if c != ' ' && c != '\n' && c != '\t' && c != '\r' {
			break
		}
		end--
	}
	return s[start:end]
}

func toString(v any) string {
	s, _ := v.(string)
	return s
}

func toInt(v any) int {
	switch x := v.(type) {
	case int:
		return x
	case int64:
		return int(x)
	case float64:
		return int(x)
	case string:
		return atoi(x)
	default:
		return 0
	}
}

func toInt64(v any) int64 {
	switch x := v.(type) {
	case int:
		return int64(x)
	case int64:
		return x
	case float64:
		return int64(x)
	case string:
		return atoi64(x)
	default:
		return 0
	}
}

func toFloatPtr(v any) (*float64, bool) {
	switch x := v.(type) {
	case float64:
		return &x, true
	case int:
		f := float64(x)
		return &f, true
	case int64:
		f := float64(x)
		return &f, true
	case string:
		f, ok := atof(x)
		if !ok {
			return nil, false
		}
		return &f, true
	default:
		return nil, false
	}
}

func atoi(s string) int {
	return int(atoi64(s))
}

func atoi64(s string) int64 {
	var n int64
	var neg bool
	for i := 0; i < len(s); i++ {
		c := s[i]
		if i == 0 && c == '-' {
			neg = true
			continue
		}
		if c < '0' || c > '9' {
			break
		}
		n = n*10 + int64(c-'0')
	}
	if neg {
		return -n
	}
	return n
}

func atof(s string) (float64, bool) {
	var n float64
	var div float64 = 1
	var neg bool
	var dot bool
	for i := 0; i < len(s); i++ {
		c := s[i]
		if i == 0 && c == '-' {
			neg = true
			continue
		}
		if c == '.' {
			if dot {
				break
			}
			dot = true
			continue
		}
		if c < '0' || c > '9' {
			break
		}
		n = n*10 + float64(c-'0')
		if dot {
			div *= 10
		}
	}
	if div != 1 {
		n = n / div
	}
	if neg {
		return -n, true
	}
	return n, true
}
