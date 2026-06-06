package devices

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

func normalizeOutputState(state OutputState) OutputState {
	switch state {
	case OutputStateActive, OutputStateSuspended, OutputStateBuffering,
		OutputStateInterrupted, OutputStateRevoked, OutputStateLost, OutputStateError:
		return state
	default:
		return OutputStateSuspended
	}
}

func normalizeDeviceCapabilities(in *DeviceCapabilities, kind string) *DeviceCapabilities {
	platform := strings.ToLower(strings.TrimSpace(kind))
	if in != nil && strings.TrimSpace(in.Platform) != "" {
		platform = strings.ToLower(strings.TrimSpace(in.Platform))
	}
	if platform == "" {
		platform = "web"
	}
	caps := &DeviceCapabilities{
		Platform:        truncate(platform, 32),
		BackgroundAudio: false,
	}
	if in != nil {
		caps.BackgroundAudio = in.BackgroundAudio
		caps.NativeVersion = truncate(strings.TrimSpace(in.NativeVersion), 64)
		for _, mode := range in.OutputModes {
			mode = strings.ToLower(strings.TrimSpace(mode))
			if mode == "" || len(caps.OutputModes) >= 8 {
				continue
			}
			caps.OutputModes = append(caps.OutputModes, truncate(mode, 32))
		}
	}
	if caps.Platform == "ios" || caps.Platform == "android" {
		caps.BackgroundAudio = caps.BackgroundAudio || (in != nil && in.BackgroundAudio)
	} else {
		caps.BackgroundAudio = false
	}
	return caps
}

func timelineFromNowPlaying(np *NowPlaying) *PlaybackTimeline {
	if np == nil {
		return nil
	}
	return &PlaybackTimeline{
		TrackID:       np.TrackID,
		Title:         np.Title,
		Artist:        np.Artist,
		Cover:         np.Cover,
		DurationSec:   np.DurationSec,
		IsPlaying:     np.IsPlaying,
		PositionSec:   np.PositionSec,
		UpdatedAtMs:   np.UpdatedAtMs,
		StateRevision: np.StateRevision,
		QueueSource:   np.QueueSource,
		QueueName:     np.QueueName,
	}
}

func (r *Registry) GetOutputLease(ctx context.Context, userID string) (*OutputLease, error) {
	uid, err := r.normalizeUserID(userID)
	if err != nil {
		return nil, err
	}
	return r.outputLeaseForNormalizedUser(ctx, uid)
}

func (r *Registry) outputLeaseForNormalizedUser(ctx context.Context, uid string) (*OutputLease, error) {
	raw, err := r.rdb.Get(ctx, r.keyLease(uid)).Result()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var lease OutputLease
	if err := json.Unmarshal([]byte(raw), &lease); err != nil {
		return nil, nil
	}
	if lease.DeviceStates == nil {
		lease.DeviceStates = map[string]OutputState{}
	}
	return &lease, nil
}

func (r *Registry) setOutputLeaseForNormalizedUser(ctx context.Context, uid string, lease *OutputLease) error {
	if lease == nil {
		return nil
	}
	if lease.DeviceStates == nil {
		lease.DeviceStates = map[string]OutputState{}
	}
	enc, err := json.Marshal(lease)
	if err != nil {
		return err
	}
	pipe := r.rdb.TxPipeline()
	pipe.Set(ctx, r.keyLease(uid), enc, r.cfg.Device.NowPlayingTTL)
	pipe.Set(ctx, r.keyActive(uid), lease.HolderDeviceID, r.cfg.Device.DeviceTTL)
	pipe.Persist(ctx, r.keyActiveRevision(uid))
	for did, state := range lease.DeviceStates {
		if strings.TrimSpace(did) == "" {
			continue
		}
		pipe.Set(ctx, r.keyOutput(uid, did), string(normalizeOutputState(state)), r.cfg.Device.DeviceTTL)
	}
	_, err = pipe.Exec(ctx)
	return err
}

func (r *Registry) publishLeaseUpdate(ctx context.Context, uid string, lease *OutputLease) {
	if lease == nil {
		return
	}
	r.publish(ctx, uid, Event{
		Type:           "lease:update",
		At:             lease.UpdatedAtMs,
		DeviceID:       optionalString(lease.HolderDeviceID),
		ActiveRevision: lease.ActiveRevision,
		Lease:          lease,
	})
}

func (r *Registry) publishTimelineUpdate(ctx context.Context, uid string, timeline *PlaybackTimeline, activeRevision int64) {
	if timeline == nil {
		return
	}
	r.publish(ctx, uid, Event{
		Type:           "timeline:update",
		At:             timeline.UpdatedAtMs,
		ActiveRevision: activeRevision,
		Timeline:       timeline,
	})
}

func (r *Registry) buildOutputLease(ctx context.Context, uid, holder, previous string, activeRevision, nowMs int64) (*OutputLease, error) {
	leaseRevision, err := r.rdb.Incr(ctx, r.keyLeaseRevision(uid)).Result()
	if err != nil {
		return nil, err
	}
	_ = r.rdb.Persist(ctx, r.keyLeaseRevision(uid)).Err()
	states := map[string]OutputState{}
	ids, _ := r.rdb.SMembers(ctx, r.keyUser(uid)).Result()
	for _, id := range ids {
		if strings.TrimSpace(id) == "" {
			continue
		}
		states[id] = OutputStateSuspended
	}
	if previous != "" && previous != holder {
		states[previous] = OutputStateRevoked
	}
	if holder != "" {
		states[holder] = OutputStateActive
	}
	return &OutputLease{
		HolderDeviceID: holder,
		ActiveRevision: activeRevision,
		LeaseRevision:  leaseRevision,
		UpdatedAtMs:    nowMs,
		DeviceStates:   states,
	}, nil
}

func (r *Registry) SetOutputState(ctx context.Context, userID, deviceID string, state OutputState, activeRevision int64) (*OutputLease, error) {
	uid, err := r.normalizeUserID(userID)
	if err != nil {
		return nil, err
	}
	did, err := r.normalizeDeviceID(deviceID)
	if err != nil {
		return nil, err
	}
	lease, err := r.outputLeaseForNormalizedUser(ctx, uid)
	if err != nil {
		return nil, err
	}
	if lease == nil {
		return nil, ErrNotActiveDevice
	}
	if activeRevision > 0 && lease.ActiveRevision > 0 && activeRevision != lease.ActiveRevision {
		return lease, ErrStaleRevision
	}
	if lease.DeviceStates == nil {
		lease.DeviceStates = map[string]OutputState{}
	}
	lease.DeviceStates[did] = normalizeOutputState(state)
	lease.UpdatedAtMs = time.Now().UnixMilli()
	if err := r.setOutputLeaseForNormalizedUser(ctx, uid, lease); err != nil {
		return nil, err
	}
	r.publishLeaseUpdate(ctx, uid, lease)
	return lease, nil
}
