package devices

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// PlayerState is the unified `player_state` frame: a union of now-playing,
// timeline, lease, transfer and per-device volume under a single monotonic
// FrameRev. Clients render this one object instead of stitching together the
// legacy per-aspect frames (which remain published for one release for
// backwards compatibility).
type PlayerState struct {
	FrameRev       int64              `json:"frameRev"`
	At             int64              `json:"at"`
	ActiveDeviceID string             `json:"activeDeviceId,omitempty"`
	ActiveRevision int64              `json:"activeRevision"`
	NowPlaying     *NowPlaying        `json:"nowPlaying,omitempty"`
	Timeline       *PlaybackTimeline  `json:"timeline,omitempty"`
	Lease          *OutputLease       `json:"lease,omitempty"`
	Transfer       *TransferRecord    `json:"transfer,omitempty"`
	VolumeByDevice map[string]float64 `json:"volumeByDevice,omitempty"`
}

// Legacy frame types that must be mirrored into a `player_state` publish so
// new clients can rely on the unified frame alone.
var playerStateTriggerFrames = map[string]struct{}{
	"np:update":       {},
	"timeline:update": {},
	"devices:update":  {},
	"devices:active":  {},
	"lease:update":    {},
	"transfer:update": {},
}

func (r *Registry) keyFrameRevision(uid string) string {
	return r.cfg.Redis.KeyPrefix + "user:" + uid + ":frame:rev"
}

func (r *Registry) keyVolume(uid, did string) string {
	return r.cfg.Redis.KeyPrefix + "user:" + uid + ":volume:" + did
}

// GetPlayerState returns the current unified snapshot with the current (not
// incremented) frame revision. Used for the WS init frame and REST reads.
func (r *Registry) GetPlayerState(ctx context.Context, userID string) (*PlayerState, error) {
	uid, err := r.normalizeUserID(userID)
	if err != nil {
		return nil, err
	}
	ps, err := r.playerStateForNormalizedUser(ctx, uid)
	if err != nil {
		return nil, err
	}
	rev, err := r.rdb.Get(ctx, r.keyFrameRevision(uid)).Int64()
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, err
	}
	if rev > 0 {
		ps.FrameRev = rev
	}
	return ps, nil
}

func (r *Registry) playerStateForNormalizedUser(ctx context.Context, uid string) (*PlayerState, error) {
	activeRevision, err := r.activeRevisionForNormalizedUser(ctx, uid)
	if err != nil {
		return nil, err
	}
	activeID, err := r.rdb.Get(ctx, r.keyActive(uid)).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, err
	}
	np, err := r.GetNowPlaying(ctx, uid)
	if err != nil {
		return nil, err
	}
	if np != nil {
		np.ActiveRevision = activeRevision
	}
	lease, err := r.outputLeaseForNormalizedUser(ctx, uid)
	if err != nil {
		return nil, err
	}
	timeline := r.timelineForNormalizedUser(ctx, uid)
	if timeline == nil {
		timeline = timelineFromNowPlaying(np)
	}
	transfer := r.activeTransferForNormalizedUser(ctx, uid)
	volumes := r.volumesForNormalizedUser(ctx, uid)
	return &PlayerState{
		At:             time.Now().UnixMilli(),
		ActiveDeviceID: activeID,
		ActiveRevision: activeRevision,
		NowPlaying:     np,
		Timeline:       timeline,
		Lease:          lease,
		Transfer:       transfer,
		VolumeByDevice: volumes,
	}, nil
}

func (r *Registry) timelineForNormalizedUser(ctx context.Context, uid string) *PlaybackTimeline {
	raw, err := r.rdb.Get(ctx, r.keyTimeline(uid)).Result()
	if err != nil || raw == "" {
		return nil
	}
	var t PlaybackTimeline
	if jerr := json.Unmarshal([]byte(raw), &t); jerr != nil {
		return nil
	}
	return &t
}

func (r *Registry) activeTransferForNormalizedUser(ctx context.Context, uid string) *TransferRecord {
	transferID, err := r.rdb.Get(ctx, r.keyActiveTransfer(uid)).Result()
	if err != nil || strings.TrimSpace(transferID) == "" {
		return nil
	}
	transfer, terr := r.GetTransfer(ctx, transferID)
	if terr != nil {
		return nil
	}
	return transfer
}

func (r *Registry) volumesForNormalizedUser(ctx context.Context, uid string) map[string]float64 {
	ids, err := r.rdb.SMembers(ctx, r.keyUser(uid)).Result()
	if err != nil || len(ids) == 0 {
		return nil
	}
	out := map[string]float64{}
	for _, id := range ids {
		if strings.TrimSpace(id) == "" {
			continue
		}
		raw, gerr := r.rdb.Get(ctx, r.keyVolume(uid, id)).Result()
		if gerr != nil || raw == "" {
			continue
		}
		v, perr := strconv.ParseFloat(raw, 64)
		if perr != nil || v < 0 || v > 1 {
			continue
		}
		out[id] = v
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func (r *Registry) setDeviceVolumeForNormalizedUser(ctx context.Context, uid, did string, volume float64) {
	if volume < 0 || volume > 1 {
		return
	}
	if err := r.rdb.Set(ctx, r.keyVolume(uid, did), strconv.FormatFloat(volume, 'f', -1, 64), r.cfg.Device.DeviceTTL).Err(); err != nil {
		r.log.Warn("persist device volume failed",
			slog.String("userId", uid),
			slog.String("deviceId", did),
			slog.Any("err", err))
	}
}

// publishPlayerState bumps the monotonic frame revision and ships the unified
// snapshot. Best-effort: failures are logged, never propagated, so legacy
// frames keep flowing even if this path degrades.
func (r *Registry) publishPlayerState(ctx context.Context, uid string) {
	rev, err := r.rdb.Incr(ctx, r.keyFrameRevision(uid)).Result()
	if err != nil {
		r.log.Warn("frame revision incr failed", slog.String("userId", uid), slog.Any("err", err))
		return
	}
	_ = r.rdb.Persist(ctx, r.keyFrameRevision(uid)).Err()
	ps, err := r.playerStateForNormalizedUser(ctx, uid)
	if err != nil {
		r.log.Warn("player state build failed", slog.String("userId", uid), slog.Any("err", err))
		return
	}
	ps.FrameRev = rev
	r.publishEvent(ctx, uid, Event{
		Type:           "player_state",
		At:             ps.At,
		ActiveRevision: ps.ActiveRevision,
		PlayerState:    ps,
	})
}
