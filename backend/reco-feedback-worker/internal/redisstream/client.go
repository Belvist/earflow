package redisstream

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"reco-feedback-worker/internal/config"
)

type Client struct {
	cfg   config.Config
	redis *redis.Client
}

type StreamMessage struct {
	ID         string
	Data       map[string]any
	Timestamp  int64
	Deliveries int64
}

type PendingEntry struct {
	ID         string
	Idle       time.Duration
	Deliveries int64
}

type RealtimeInteraction struct {
	UserID  int
	TrackID int
	Action  string
}

func NewClient(cfg config.Config) (*Client, error) {
	opts := &redis.Options{
		Addr:        cfg.Redis.Host + ":" + itoa(cfg.Redis.Port),
		Password:    cfg.Redis.Password,
		DB:          cfg.Redis.DB,
		DialTimeout: cfg.Redis.ConnectTimout,
	}
	c := redis.NewClient(opts)
	return &Client{cfg: cfg, redis: c}, nil
}

func (c *Client) Close() error {
	return c.redis.Close()
}

func (c *Client) InitFeedbackStream(ctx context.Context) error {
	err := c.redis.XGroupCreateMkStream(ctx, c.cfg.Keys.FeedbackStream, c.cfg.Keys.FeedbackGroup, "0").Err()
	if err == nil {
		return nil
	}
	if strings.Contains(err.Error(), "BUSYGROUP") {
		return nil
	}
	return err
}

func (c *Client) ReadBatch(ctx context.Context, count int, block time.Duration) ([]StreamMessage, error) {
	res, err := c.xReadGroup(ctx, count, block)
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return []StreamMessage{}, nil
		}
		if isNoGroupErr(err) {
			if initErr := c.InitFeedbackStream(ctx); initErr == nil {
				res, err = c.xReadGroup(ctx, count, block)
				if err == nil {
					return parseReadGroupResult(res, count), nil
				}
			}
		}
		return nil, err
	}

	return parseReadGroupResult(res, count), nil
}

func (c *Client) xReadGroup(ctx context.Context, count int, block time.Duration) ([]redis.XStream, error) {
	return c.redis.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group:    c.cfg.Keys.FeedbackGroup,
		Consumer: c.cfg.Worker.ConsumerName,
		Streams:  []string{c.cfg.Keys.FeedbackStream, ">"},
		Count:    int64(count),
		Block:    block,
		NoAck:    false,
	}).Result()
}

func isNoGroupErr(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "NOGROUP")
}

func parseReadGroupResult(res []redis.XStream, capHint int) []StreamMessage {
	out := make([]StreamMessage, 0, capHint)
	for _, s := range res {
		for _, m := range s.Messages {
			msg, ok := parseStreamMessage(m)
			if ok {
				out = append(out, msg)
			}
		}
	}
	return out
}

func (c *Client) Ack(ctx context.Context, ids []string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	acked, err := c.redis.XAck(ctx, c.cfg.Keys.FeedbackStream, c.cfg.Keys.FeedbackGroup, ids...).Result()
	return acked, err
}

func (c *Client) MoveToDLQ(ctx context.Context, id string, data map[string]any, errMsg string) error {
	payload, _ := json.Marshal(data)
	pipe := c.redis.TxPipeline()
	pipe.XAdd(ctx, &redis.XAddArgs{Stream: c.cfg.Keys.FeedbackDLQ, Values: map[string]any{
		"originalId": id,
		"data":       string(payload),
		"error":      errMsg,
		"timestamp":  itoa64(time.Now().UnixMilli()),
	}})
	pipe.XAck(ctx, c.cfg.Keys.FeedbackStream, c.cfg.Keys.FeedbackGroup, id)
	_, err := pipe.Exec(ctx)
	return err
}

func (c *Client) Pending(ctx context.Context, count int, minIdle time.Duration) ([]PendingEntry, error) {
	p, err := c.redis.XPending(ctx, c.cfg.Keys.FeedbackStream, c.cfg.Keys.FeedbackGroup).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return []PendingEntry{}, nil
		}
		return nil, err
	}
	if p.Count == 0 {
		return []PendingEntry{}, nil
	}

	rng, err := c.redis.XPendingExt(ctx, &redis.XPendingExtArgs{
		Stream: c.cfg.Keys.FeedbackStream,
		Group:  c.cfg.Keys.FeedbackGroup,
		Start:  "-",
		End:    "+",
		Count:  int64(count),
	}).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return []PendingEntry{}, nil
		}
		return nil, err
	}

	out := make([]PendingEntry, 0, len(rng))
	for _, e := range rng {
		idle := time.Duration(e.Idle) * time.Millisecond
		if idle < minIdle {
			continue
		}
		out = append(out, PendingEntry{ID: e.ID, Idle: idle, Deliveries: e.RetryCount})
	}
	return out, nil
}

func (c *Client) Claim(ctx context.Context, ids []string, minIdle time.Duration) ([]StreamMessage, error) {
	if len(ids) == 0 {
		return []StreamMessage{}, nil
	}
	msgs, err := c.redis.XClaim(ctx, &redis.XClaimArgs{
		Stream:   c.cfg.Keys.FeedbackStream,
		Group:    c.cfg.Keys.FeedbackGroup,
		Consumer: c.cfg.Worker.ConsumerName,
		MinIdle:  minIdle,
		Messages: ids,
	}).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return []StreamMessage{}, nil
		}
		return nil, err
	}

	out := make([]StreamMessage, 0, len(msgs))
	for _, m := range msgs {
		msg, ok := parseStreamMessage(m)
		if ok {
			out = append(out, msg)
		}
	}
	return out, nil
}

func (c *Client) SessionHadImpressions(ctx context.Context, sessionID string, ids []int) (map[int]bool, error) {
	if sessionID == "" {
		return map[int]bool{}, nil
	}
	norm := make([]int, 0, len(ids))
	seen := map[int]struct{}{}
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		norm = append(norm, id)
	}
	if len(norm) == 0 {
		return map[int]bool{}, nil
	}

	key := c.cfg.Keys.ImpressionsKey(sessionID)

	members := make([]any, 0, len(norm))
	for _, id := range norm {
		members = append(members, itoa(id))
	}

	if c.redis != nil {
		r := c.redis.SMIsMember(ctx, key, members...)
		if err := r.Err(); err == nil {
			vals, _ := r.Result()
			out := make(map[int]bool, len(norm))
			for i := 0; i < len(norm) && i < len(vals); i++ {
				out[norm[i]] = vals[i]
			}
			return out, nil
		}
	}

	pipe := c.redis.Pipeline()
	cmds := make([]*redis.BoolCmd, 0, len(norm))
	for _, id := range norm {
		cmds = append(cmds, pipe.SIsMember(ctx, key, itoa(id)))
	}
	_, err := pipe.Exec(ctx)
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, err
	}

	out := make(map[int]bool, len(norm))
	for i, cmd := range cmds {
		v, e := cmd.Result()
		if e == nil {
			out[norm[i]] = v
		}
	}

	return out, nil
}

func (c *Client) MarkRealtimeDelta(ctx context.Context, interactions []RealtimeInteraction) (int, error) {
	if c == nil || c.redis == nil || len(interactions) == 0 {
		return 0, nil
	}

	seenDaily := map[int]map[int]struct{}{}
	pipe := c.redis.Pipeline()
	ops := 0

	for _, it := range interactions {
		if it.UserID <= 0 || it.TrackID <= 0 {
			continue
		}

		switch strings.ToLower(strings.TrimSpace(it.Action)) {
		case "play", "complete", "like":
			pipe.Set(ctx, c.cfg.Keys.RecentTrackKey(it.UserID, it.TrackID), "1", c.cfg.Realtime.RecentTTL)
			ops++
			addSeen(seenDaily, it.UserID, it.TrackID)
		case "skip":
			pipe.Set(ctx, c.cfg.Keys.SkipTrackKey(it.UserID, it.TrackID), "1", c.cfg.Realtime.SkipTTL)
			pipe.Set(ctx, c.cfg.Keys.RecentTrackKey(it.UserID, it.TrackID), "1", c.cfg.Realtime.RecentTTL)
			ops += 2
			addSeen(seenDaily, it.UserID, it.TrackID)
		case "dislike":
			pipe.Set(ctx, c.cfg.Keys.DislikeTrackKey(it.UserID, it.TrackID), "1", c.cfg.Realtime.DislikeTTL)
			pipe.Set(ctx, c.cfg.Keys.SkipTrackKey(it.UserID, it.TrackID), "1", c.cfg.Realtime.SkipTTL)
			ops += 2
			addSeen(seenDaily, it.UserID, it.TrackID)
		}
	}

	for userID, ids := range seenDaily {
		values := make([]any, 0, len(ids))
		for id := range ids {
			values = append(values, itoa(id))
		}
		if len(values) == 0 {
			continue
		}
		key := c.cfg.Keys.DailySeenKey(userID)
		pipe.SAdd(ctx, key, values...)
		pipe.Expire(ctx, key, c.cfg.Realtime.DailySeenTTL)
		ops += 2
	}

	if ops == 0 {
		return 0, nil
	}
	_, err := pipe.Exec(ctx)
	if err != nil && !errors.Is(err, redis.Nil) {
		return 0, err
	}
	return ops, nil
}

func addSeen(dst map[int]map[int]struct{}, userID int, trackID int) {
	items := dst[userID]
	if items == nil {
		items = map[int]struct{}{}
		dst[userID] = items
	}
	items[trackID] = struct{}{}
}

func parseStreamMessage(m redis.XMessage) (StreamMessage, bool) {
	raw, ok := m.Values["data"]
	if !ok {
		return StreamMessage{}, false
	}
	dataStr, ok := raw.(string)
	if !ok {
		return StreamMessage{}, false
	}

	var data map[string]any
	if err := json.Unmarshal([]byte(dataStr), &data); err != nil {
		return StreamMessage{}, false
	}

	var ts int64
	tsRaw, ok := m.Values["timestamp"]
	if ok {
		switch v := tsRaw.(type) {
		case string:
			ts = atoi64(v)
		case int64:
			ts = v
		}
	}

	return StreamMessage{ID: m.ID, Data: data, Timestamp: ts}, true
}

func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	neg := false
	if v < 0 {
		neg = true
		v = -v
	}
	buf := make([]byte, 0, 16)
	for v > 0 {
		d := v % 10
		buf = append(buf, byte('0'+d))
		v /= 10
	}
	for i, j := 0, len(buf)-1; i < j; i, j = i+1, j-1 {
		buf[i], buf[j] = buf[j], buf[i]
	}
	if neg {
		buf = append([]byte{'-'}, buf...)
	}
	return string(buf)
}

func itoa64(v int64) string {
	if v == 0 {
		return "0"
	}
	neg := false
	if v < 0 {
		neg = true
		v = -v
	}
	buf := make([]byte, 0, 32)
	for v > 0 {
		d := v % 10
		buf = append(buf, byte('0'+d))
		v /= 10
	}
	for i, j := 0, len(buf)-1; i < j; i, j = i+1, j-1 {
		buf[i], buf[j] = buf[j], buf[i]
	}
	if neg {
		buf = append([]byte{'-'}, buf...)
	}
	return string(buf)
}

func atoi64(s string) int64 {
	var n int64
	var neg bool
	for i, r := range s {
		if i == 0 && r == '-' {
			neg = true
			continue
		}
		if r < '0' || r > '9' {
			break
		}
		n = n*10 + int64(r-'0')
	}
	if neg {
		return -n
	}
	return n
}
