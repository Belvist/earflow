package party

import (
	"encoding/json"
	"strconv"
	"strings"
)

// JSON shapes stored in Redis and returned to clients (same as v2 TS + UI fields).

type Permissions struct {
	GuestsCanPlayPause       bool `json:"guestsCanPlayPause"`
	GuestsCanSeek            bool `json:"guestsCanSeek"`
	GuestsCanAddToQueue      bool `json:"guestsCanAddToQueue"`
	GuestsCanRemoveFromQueue bool `json:"guestsCanRemoveFromQueue"`
	GuestsCanSkip            bool `json:"guestsCanSkip"`
	// Aliases for legacy client field names
	GuestsCanChangePlayback bool `json:"guestsCanChangePlayback"`
}

func (p *Permissions) UnmarshalJSON(b []byte) error {
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return err
	}
	p.GuestsCanPlayPause = jsonBool(m["guestsCanPlayPause"], false)
	p.GuestsCanSeek = jsonBool(m["guestsCanSeek"], false)
	p.GuestsCanAddToQueue = jsonBool(m["guestsCanAddToQueue"], false)
	p.GuestsCanRemoveFromQueue = jsonBool(m["guestsCanRemoveFromQueue"], false)
	p.GuestsCanSkip = jsonBool(m["guestsCanSkip"], false)
	p.GuestsCanChangePlayback = jsonBool(m["guestsCanChangePlayback"], p.GuestsCanPlayPause)
	if !p.GuestsCanPlayPause && p.GuestsCanChangePlayback {
		p.GuestsCanPlayPause = true
	}
	if !p.GuestsCanChangePlayback && p.GuestsCanPlayPause {
		p.GuestsCanChangePlayback = true
	}
	return nil
}

type PlaybackState struct {
	TrackID             *string `json:"trackId"`
	IsPlaying           bool    `json:"isPlaying"`
	PositionMs          int64   `json:"positionMs"`
	PositionUpdatedAtMs int64   `json:"positionUpdatedAtMs"`
	TrackTitle          *string `json:"trackTitle,omitempty"`
	TrackArtist         *string `json:"trackArtist,omitempty"`
	TrackCover          *string `json:"trackCover,omitempty"`
	TrackDuration       int64   `json:"trackDuration,omitempty"`
}

func (p *PlaybackState) UnmarshalJSON(b []byte) error {
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return err
	}
	p.TrackID = jsonStringPtr(m["trackId"])
	p.IsPlaying = jsonBool(m["isPlaying"], false)
	p.PositionMs = jsonMillis(m["positionMs"], m["position"])
	p.PositionUpdatedAtMs = jsonInt64(m["positionUpdatedAtMs"], jsonInt64(m["serverTimestamp"], 0))
	p.TrackTitle = jsonStringPtr(m["trackTitle"])
	p.TrackArtist = jsonStringPtr(m["trackArtist"])
	p.TrackCover = jsonStringPtr(m["trackCover"])
	p.TrackDuration = jsonDurationMillis(m["trackDuration"], m["trackDurationSeconds"])
	if p.TrackDuration == 0 {
		p.TrackDuration = jsonMillis(m["durationMs"], m["duration"])
	}
	return nil
}

type QueueItem struct {
	QueueID     string  `json:"queueId,omitempty"`
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Artist      string  `json:"artist"`
	Cover       *string `json:"cover"`
	DurationMs  int64   `json:"durationMs"`
	AddedBy     string  `json:"addedBy"`
	AddedByName string  `json:"addedByName"`
	AddedAtMs   int64   `json:"addedAtMs"`
}

func (q *QueueItem) UnmarshalJSON(b []byte) error {
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return err
	}
	q.QueueID = jsonString(m["queueId"])
	q.ID = jsonString(m["id"])
	if q.ID == "" {
		q.ID = jsonString(m["trackId"])
	}
	q.Title = jsonString(m["title"])
	q.Artist = jsonString(m["artist"])
	q.Cover = jsonStringPtr(m["cover"])
	if q.Cover == nil {
		q.Cover = jsonStringPtr(m["cover_path"])
	}
	q.DurationMs = jsonMillis(m["durationMs"], m["duration"])
	q.AddedBy = jsonString(m["addedBy"])
	q.AddedByName = jsonString(m["addedByName"])
	q.AddedAtMs = jsonInt64(m["addedAtMs"], jsonInt64(m["addedAt"], 0))
	return nil
}

type Participant struct {
	UserID     string `json:"userId"`
	Username   string `json:"username"`
	IsHost     bool   `json:"isHost"`
	JoinedAtMs int64  `json:"joinedAtMs"`
}

func (p *Participant) UnmarshalJSON(b []byte) error {
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return err
	}
	p.UserID = jsonString(m["userId"])
	if p.UserID == "" {
		p.UserID = jsonString(m["id"])
	}
	p.Username = jsonString(m["username"])
	if p.Username == "" {
		p.Username = jsonString(m["name"])
	}
	p.IsHost = jsonBool(m["isHost"], false)
	p.JoinedAtMs = jsonInt64(m["joinedAtMs"], jsonInt64(m["joinedAt"], 0))
	return nil
}

type PartyDoc struct {
	V               int                    `json:"v"`
	ID              string                 `json:"id"`
	Title           string                 `json:"title"`
	Description     string                 `json:"description,omitempty"`
	IsPrivate       bool                   `json:"isPrivate"`
	HostID          string                 `json:"hostId"`
	HostName        string                 `json:"hostName"`
	CreatedAtMs     int64                  `json:"createdAtMs"`
	EndedAtMs       *int64                 `json:"endedAtMs"`
	Rev             int64                  `json:"rev"`
	Permissions     Permissions            `json:"permissions"`
	Playback        PlaybackState          `json:"playback"`
	Participants    map[string]Participant `json:"participants"`
	Queue           []QueueItem            `json:"queue"`
	MaxParticipants int                    `json:"maxParticipants"`
}

func (d *PartyDoc) UnmarshalJSON(b []byte) error {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		return err
	}

	d.V = int(jsonInt64Raw(m["v"], 1))
	d.ID = jsonStringRaw(m["id"])
	d.Title = jsonStringRaw(m["title"])
	d.Description = jsonStringRaw(m["description"])
	d.IsPrivate = jsonBoolRaw(m["isPrivate"], true)
	d.HostID = jsonStringRaw(m["hostId"])
	d.HostName = jsonStringRaw(m["hostName"])
	d.CreatedAtMs = jsonTimeMillisRaw(m["createdAtMs"], m["createdAt"])
	d.EndedAtMs = jsonInt64PtrRaw(m["endedAtMs"])
	d.Rev = jsonInt64Raw(m["rev"], 0)
	d.MaxParticipants = int(jsonInt64Raw(m["maxParticipants"], 0))
	if d.MaxParticipants <= 0 {
		d.MaxParticipants = 50
	}

	d.Permissions = DefaultPerms
	if raw, ok := m["permissions"]; ok && !jsonIsNull(raw) {
		var perms Permissions
		if err := json.Unmarshal(raw, &perms); err == nil {
			d.Permissions = perms
		}
	}

	if raw, ok := m["playback"]; ok && !jsonIsNull(raw) {
		var pb PlaybackState
		if err := json.Unmarshal(raw, &pb); err == nil {
			d.Playback = pb
		}
	}

	d.Participants = decodeParticipants(m["participants"])
	if d.Participants == nil {
		d.Participants = map[string]Participant{}
	}
	d.Queue = decodeQueue(m["queue"])
	if d.Queue == nil {
		d.Queue = []QueueItem{}
	}
	return nil
}

// DefaultPerms: guest-friendly; host can always control via Lua (isHost).
var DefaultPerms = Permissions{
	GuestsCanPlayPause:       true,
	GuestsCanSeek:            true,
	GuestsCanAddToQueue:      true,
	GuestsCanRemoveFromQueue: false,
	GuestsCanSkip:            false,
	GuestsCanChangePlayback:  true,
}

func decodeParticipants(raw json.RawMessage) map[string]Participant {
	if len(raw) == 0 || jsonIsNull(raw) {
		return map[string]Participant{}
	}
	var byID map[string]Participant
	if err := json.Unmarshal(raw, &byID); err == nil && byID != nil {
		out := make(map[string]Participant, len(byID))
		for id, p := range byID {
			if p.UserID == "" {
				p.UserID = id
			}
			if p.Username == "" {
				p.Username = "User"
			}
			out[p.UserID] = p
		}
		return out
	}
	var list []Participant
	if err := json.Unmarshal(raw, &list); err == nil {
		out := make(map[string]Participant, len(list))
		for i, p := range list {
			if p.UserID == "" {
				p.UserID = strconv.Itoa(i)
			}
			if p.Username == "" {
				p.Username = "User"
			}
			out[p.UserID] = p
		}
		return out
	}
	return map[string]Participant{}
}

func decodeQueue(raw json.RawMessage) []QueueItem {
	if len(raw) == 0 || jsonIsNull(raw) {
		return []QueueItem{}
	}
	var list []QueueItem
	if err := json.Unmarshal(raw, &list); err == nil {
		return list
	}
	var byID map[string]QueueItem
	if err := json.Unmarshal(raw, &byID); err == nil {
		out := make([]QueueItem, 0, len(byID))
		for id, item := range byID {
			if item.ID == "" {
				item.ID = id
			}
			out = append(out, item)
		}
		return out
	}
	return []QueueItem{}
}

func jsonIsNull(raw json.RawMessage) bool {
	return strings.EqualFold(strings.TrimSpace(string(raw)), "null")
}

func jsonStringRaw(raw json.RawMessage) string {
	if len(raw) == 0 || jsonIsNull(raw) {
		return ""
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return ""
	}
	return jsonString(v)
}

func jsonString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(x)
	case json.Number:
		return x.String()
	case float64:
		if x == float64(int64(x)) {
			return strconv.FormatInt(int64(x), 10)
		}
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		if x {
			return "true"
		}
		return "false"
	default:
		return strings.TrimSpace(strings.Trim(strings.TrimSpace(toJSONString(x)), `"`))
	}
}

func jsonStringPtr(v any) *string {
	s := jsonString(v)
	if s == "" {
		return nil
	}
	return &s
}

func jsonBoolRaw(raw json.RawMessage, def bool) bool {
	if len(raw) == 0 || jsonIsNull(raw) {
		return def
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return def
	}
	return jsonBool(v, def)
}

func jsonBool(v any, def bool) bool {
	switch x := v.(type) {
	case bool:
		return x
	case string:
		s := strings.TrimSpace(strings.ToLower(x))
		if s == "true" || s == "1" || s == "yes" {
			return true
		}
		if s == "false" || s == "0" || s == "no" {
			return false
		}
	case float64:
		return x != 0
	case json.Number:
		n, err := x.Float64()
		if err == nil {
			return n != 0
		}
	}
	return def
}

func jsonInt64PtrRaw(raw json.RawMessage) *int64 {
	if len(raw) == 0 || jsonIsNull(raw) {
		return nil
	}
	v := jsonInt64Raw(raw, 0)
	return &v
}

func jsonInt64Raw(raw json.RawMessage, def int64) int64 {
	if len(raw) == 0 || jsonIsNull(raw) {
		return def
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return def
	}
	return jsonInt64(v, def)
}

func jsonInt64(v any, def int64) int64 {
	switch x := v.(type) {
	case float64:
		return int64(x)
	case json.Number:
		n, err := x.Int64()
		if err == nil {
			return n
		}
		f, err := x.Float64()
		if err == nil {
			return int64(f)
		}
	case string:
		s := strings.TrimSpace(x)
		if s == "" {
			return def
		}
		n, err := strconv.ParseInt(s, 10, 64)
		if err == nil {
			return n
		}
		f, err := strconv.ParseFloat(s, 64)
		if err == nil {
			return int64(f)
		}
	}
	return def
}

func jsonMillisRaw(msRaw json.RawMessage, secondsRaw json.RawMessage) int64 {
	if len(msRaw) > 0 && !jsonIsNull(msRaw) {
		return jsonInt64Raw(msRaw, 0)
	}
	if len(secondsRaw) == 0 || jsonIsNull(secondsRaw) {
		return 0
	}
	var v any
	if err := json.Unmarshal(secondsRaw, &v); err != nil {
		return 0
	}
	return secondsToMillis(v)
}

func jsonMillis(msValue any, secondsValue any) int64 {
	if msValue != nil {
		return jsonInt64(msValue, 0)
	}
	return secondsToMillis(secondsValue)
}

func jsonDurationMillis(value any, secondsValue any) int64 {
	if value == nil {
		return secondsToMillis(secondsValue)
	}
	n, ok := jsonFloat64(value)
	if !ok || n <= 0 {
		return 0
	}
	if n < 1000 {
		return int64(n * 1000)
	}
	return int64(n)
}

func jsonTimeMillisRaw(msRaw json.RawMessage, secondsRaw json.RawMessage) int64 {
	if len(msRaw) > 0 && !jsonIsNull(msRaw) {
		return jsonInt64Raw(msRaw, 0)
	}
	if len(secondsRaw) == 0 || jsonIsNull(secondsRaw) {
		return 0
	}
	var v any
	if err := json.Unmarshal(secondsRaw, &v); err != nil {
		return 0
	}
	n, ok := jsonFloat64(v)
	if !ok || n <= 0 {
		return 0
	}
	if n < 1e12 {
		return int64(n * 1000)
	}
	return int64(n)
}

func secondsToMillis(v any) int64 {
	n, ok := jsonFloat64(v)
	if !ok || n <= 0 {
		return 0
	}
	return int64(n * 1000)
}

func jsonFloat64(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case json.Number:
		n, err := x.Float64()
		return n, err == nil
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		if err != nil {
			return 0, false
		}
		return f, true
	}
	return 0, false
}

func toJSONString(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}
