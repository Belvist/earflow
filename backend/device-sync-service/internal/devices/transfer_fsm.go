package devices

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const (
	transferStepRevoke   = "revoke"
	transferStepActivate = "activate"
)

func (r *Registry) SetActiveDevice(ctx context.Context, userID, did string, resumeOverride *bool) (previousActiveID string, activeRevision int64, err error) {
	prev, rev, _, err := r.StartTransfer(ctx, userID, did, resumeOverride, "")
	return prev, rev, err
}

func (r *Registry) StartTransfer(ctx context.Context, userID, did string, resumeOverride *bool, idempotencyKey string) (previousActiveID string, activeRevision int64, transfer *TransferRecord, err error) {
	return r.startTransfer(ctx, userID, did, resumeOverride, idempotencyKey, nil)
}

func (r *Registry) startTransfer(ctx context.Context, userID, did string, resumeOverride *bool, idempotencyKey string, bootstrapNowPlaying *NowPlaying) (previousActiveID string, activeRevision int64, transfer *TransferRecord, err error) {
	uid, err := r.normalizeUserID(userID)
	if err != nil {
		return "", 0, nil, err
	}
	did, err = r.normalizeDeviceID(did)
	if err != nil {
		return "", 0, nil, err
	}
	d, err := r.loadDevice(ctx, did)
	if err != nil {
		return "", 0, nil, err
	}
	if d == nil {
		return "", 0, nil, ErrDeviceNotFound
	}
	if d.UserID != uid {
		return "", 0, nil, ErrNotOwned
	}

	if idempotencyKey = strings.TrimSpace(idempotencyKey); idempotencyKey != "" {
		if existing, err := r.transferByIdempotencyKey(ctx, uid, idempotencyKey); err == nil && existing != nil {
			return existing.FromDeviceID, existing.ActiveRevision, existing, nil
		}
	}

	prev, _ := r.rdb.Get(ctx, r.keyActive(uid)).Result()
	nowMs := time.Now().UnixMilli()

	// Already active on the target device: short-circuit without bumping
	// activeRevision or emitting any publish/lease/transfer frames, otherwise
	// other devices with the current revision would be pruned as stale later
	// (INV-DS-001 fencing). Reuse an idempotent reconciled record so callers
	// (UI) still receive a deterministic transfer shape.
	if prev == did {
		var currentRev int64
		if rv, err := r.rdb.Get(ctx, r.keyActiveRevision(uid)).Result(); err == nil {
			if parsed, perr := strconv.ParseInt(strings.TrimSpace(rv), 10, 64); perr == nil {
				currentRev = parsed
			}
		}
		existingTransfer := &TransferRecord{
			TransferID:        uuid.NewString(),
			UserID:            uid,
			FromDeviceID:      did,
			ToDeviceID:        did,
			Phase:             TransferReconciled,
			ActiveRevision:    currentRev,
			Resume:            false,
			IdempotencyKey:    idempotencyKey,
			CreatedAtMs:       nowMs,
			UpdatedAtMs:       nowMs,
			ExpiresAtMs:       nowMs + r.cfg.Transfer.RecordTTL.Milliseconds(),
			RevokeAcked:       true,
			RevokeCommandID:   "",
			ActivateCommandID: "",
		}
		if err := r.saveTransfer(ctx, existingTransfer); err != nil {
			return "", 0, nil, err
		}
		if idempotencyKey != "" {
			_ = r.saveTransferIdempotency(ctx, uid, idempotencyKey, existingTransfer.TransferID)
		}
		return prev, currentRev, existingTransfer, nil
	}

	np := r.buildBootstrappedNowPlaying(ctx, uid, did, nowMs, resumeOverride, bootstrapNowPlaying)
	if np == nil {
		np = r.buildTransferredNowPlaying(ctx, uid, did, nowMs, resumeOverride)
	}
	timeline := timelineFromNowPlaying(np)

	pipe := r.rdb.TxPipeline()
	pipe.Set(ctx, r.keyActive(uid), did, r.cfg.Device.DeviceTTL)
	activeRevisionCmd := pipe.Incr(ctx, r.keyActiveRevision(uid))
	pipe.Persist(ctx, r.keyActiveRevision(uid))
	if np != nil {
		enc, jerr := json.Marshal(np)
		if jerr != nil {
			return "", 0, nil, jerr
		}
		pipe.Set(ctx, r.keyNowPlaying(uid), enc, r.cfg.Device.NowPlayingTTL)
	}
	if timeline != nil {
		enc, jerr := json.Marshal(timeline)
		if jerr != nil {
			return "", 0, nil, jerr
		}
		pipe.Set(ctx, r.keyTimeline(uid), enc, r.cfg.Device.NowPlayingTTL)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return "", 0, nil, err
	}
	activeRevision = activeRevisionCmd.Val()
	if np != nil {
		np.ActiveRevision = activeRevision
	}

	lease, err := r.buildOutputLease(ctx, uid, did, prev, activeRevision, nowMs)
	if err != nil {
		return "", 0, nil, err
	}
	if err := r.setOutputLeaseForNormalizedUser(ctx, uid, lease); err != nil {
		return "", 0, nil, err
	}

	resume := false
	if np != nil {
		resume = np.IsPlaying
	} else if resumeOverride != nil {
		resume = *resumeOverride
	}

	transfer = &TransferRecord{
		TransferID:        uuid.NewString(),
		UserID:            uid,
		FromDeviceID:      prev,
		ToDeviceID:        did,
		Phase:             TransferRequested,
		ActiveRevision:    activeRevision,
		Resume:            resume,
		IdempotencyKey:    idempotencyKey,
		TimelineSnapshot:  timeline,
		CreatedAtMs:       nowMs,
		UpdatedAtMs:       nowMs,
		ExpiresAtMs:       nowMs + r.cfg.Transfer.RecordTTL.Milliseconds(),
		RevokeCommandID:   uuid.NewString(),
		ActivateCommandID: uuid.NewString(),
	}
	if prev == "" || prev == did {
		transfer.RevokeAcked = true
	}
	if err := r.saveTransfer(ctx, transfer); err != nil {
		return "", 0, nil, err
	}
	_ = r.rdb.SAdd(ctx, r.keyTransfersActive(), transfer.TransferID).Err()
	if idempotencyKey != "" {
		_ = r.saveTransferIdempotency(ctx, uid, idempotencyKey, transfer.TransferID)
	}
	_ = r.rdb.Set(ctx, r.keyActiveTransfer(uid), transfer.TransferID, r.cfg.Transfer.RecordTTL).Err()

	r.publish(ctx, uid, Event{
		Type:             "devices:active",
		At:               nowMs,
		DeviceID:         strPtr(did),
		PreviousActiveID: optionalString(prev),
		ActiveRevision:   activeRevision,
	})
	if np != nil {
		r.publish(ctx, uid, Event{
			Type:           "np:update",
			At:             np.UpdatedAtMs,
			ActiveRevision: activeRevision,
			State:          np,
		})
	}
	r.publishTimelineUpdate(ctx, uid, timeline, activeRevision)
	r.publishLeaseUpdate(ctx, uid, lease)
	r.publishTransferUpdate(ctx, uid, transfer)

	deadlineMs := nowMs + r.cfg.Transfer.AckTimeout.Milliseconds()
	if prev != "" && prev != did {
		revokePayload := transferRevokePayload(did, activeRevision, np)
		revokePayload["transferId"] = transfer.TransferID
		revokePayload["commandId"] = transfer.RevokeCommandID
		revokePayload["step"] = transferStepRevoke
		revokePayload["deadlineMs"] = deadlineMs
		r.publish(ctx, uid, Event{
			Type:    "cmd",
			At:      nowMs,
			From:    nil,
			To:      strPtr(prev),
			Cmd:     CommandRevokeAudio,
			Payload: revokePayload,
		})
		transfer.Phase = TransferRevokeSent
		if r.m != nil {
			r.m.RevokeAudio.Inc()
		}
	} else {
		transfer.Phase = TransferOldOutputRevoked
	}

	activatePayload := map[string]interface{}{
		"activeDeviceId": did,
		"activeRevision": activeRevision,
		"resume":         resume,
		"nowPlaying":     np,
		"timeline":       timeline,
		"lease":          lease,
		"transferId":     transfer.TransferID,
		"commandId":      transfer.ActivateCommandID,
		"step":           transferStepActivate,
		"deadlineMs":     deadlineMs,
	}
	r.publish(ctx, uid, Event{
		Type:    "cmd",
		At:      nowMs,
		From:    nil,
		To:      strPtr(did),
		Cmd:     CommandTransfer,
		Payload: activatePayload,
	})
	if transfer.Phase == TransferOldOutputRevoked {
		transfer.Phase = TransferNewOutputActivated
	}
	transfer.UpdatedAtMs = time.Now().UnixMilli()
	if err := r.saveTransfer(ctx, transfer); err != nil {
		return "", 0, nil, err
	}
	r.publishTransferUpdateWithPlayerState(ctx, uid, transfer)

	if r.m != nil {
		r.m.Transfers.Inc()
	}
	r.log.Info("active device transfer started",
		slog.String("userId", uid),
		slog.String("transferId", transfer.TransferID),
		slog.String("deviceId", did),
		slog.String("previousActiveId", prev),
		slog.Int64("activeRevision", activeRevision),
	)
	return prev, activeRevision, transfer, nil
}

func (r *Registry) saveTransfer(ctx context.Context, transfer *TransferRecord) error {
	if transfer == nil || strings.TrimSpace(transfer.TransferID) == "" {
		return nil
	}
	enc, err := json.Marshal(transfer)
	if err != nil {
		return err
	}
	ttl := r.cfg.Transfer.RecordTTL
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}
	return r.rdb.Set(ctx, r.keyTransfer(transfer.TransferID), enc, ttl).Err()
}

func (r *Registry) GetTransfer(ctx context.Context, transferID string) (*TransferRecord, error) {
	transferID = strings.TrimSpace(transferID)
	if transferID == "" {
		return nil, ErrInvalidCommandPayload
	}
	raw, err := r.rdb.Get(ctx, r.keyTransfer(transferID)).Result()
	if errors.Is(err, redis.Nil) {
		return nil, ErrDeviceNotFound
	}
	if err != nil {
		return nil, err
	}
	var transfer TransferRecord
	if err := json.Unmarshal([]byte(raw), &transfer); err != nil {
		return nil, err
	}
	return &transfer, nil
}

func (r *Registry) transferByIdempotencyKey(ctx context.Context, uid, idempotencyKey string) (*TransferRecord, error) {
	key := r.keyIdempotency(uid, idempotencyKey)
	if key == "" {
		return nil, nil
	}
	transferID, err := r.rdb.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return r.GetTransfer(ctx, transferID)
}

func (r *Registry) saveTransferIdempotency(ctx context.Context, uid, idempotencyKey, transferID string) error {
	key := r.keyIdempotency(uid, idempotencyKey)
	if key == "" {
		return nil
	}
	return r.rdb.Set(ctx, key, transferID, r.cfg.Transfer.IdempotencyTTL).Err()
}

func (r *Registry) publishTransferUpdate(ctx context.Context, uid string, transfer *TransferRecord) {
	if transfer == nil {
		return
	}
	r.publish(ctx, uid, Event{
		Type:           "transfer:update",
		At:             transfer.UpdatedAtMs,
		DeviceID:       optionalString(transfer.ToDeviceID),
		ActiveRevision: transfer.ActiveRevision,
		Transfer:       transfer,
	})
}

func (r *Registry) publishTransferUpdateWithPlayerState(ctx context.Context, uid string, transfer *TransferRecord) {
	if transfer == nil {
		return
	}
	r.publishTransferUpdate(ctx, uid, transfer)
	r.publishPlayerState(ctx, uid)
}

func (r *Registry) HandleCmdAck(ctx context.Context, userID string, ack CmdAck) (*TransferRecord, error) {
	uid, err := r.normalizeUserID(userID)
	if err != nil {
		return nil, err
	}
	did, err := r.normalizeDeviceID(ack.DeviceID)
	if err != nil {
		return nil, err
	}
	d, err := r.loadDevice(ctx, did)
	if err != nil {
		return nil, err
	}
	if d == nil {
		return nil, ErrDeviceNotFound
	}
	if d.UserID != uid {
		return nil, ErrNotOwned
	}
	if strings.TrimSpace(ack.CommandID) == "" {
		return nil, ErrInvalidCommandPayload
	}
	dedupKey := r.keyCmdDedup(uid, ack.CommandID)
	if ok, _ := r.rdb.SetNX(ctx, dedupKey, "1", r.cfg.Transfer.RecordTTL).Result(); !ok {
		return r.GetTransfer(ctx, ack.TransferID)
	}

	transfer, err := r.GetTransfer(ctx, ack.TransferID)
	if err != nil {
		return nil, err
	}
	if ack.ActiveRevision > 0 && transfer.ActiveRevision > 0 && ack.ActiveRevision != transfer.ActiveRevision {
		if r.m != nil {
			r.m.RevisionRejected.Inc()
		}
		return transfer, ErrStaleRevision
	}
	nowMs := time.Now().UnixMilli()
	transfer.UpdatedAtMs = nowMs
	if !ack.Ok {
		transfer.Phase = TransferFailed
		transfer.LastError = truncate(ack.Reason, 160)
		if r.m != nil {
			r.m.TransferFailed.Inc()
		}
		_ = r.saveTransfer(ctx, transfer)
		r.publishTransferUpdateWithPlayerState(ctx, uid, transfer)
		return transfer, nil
	}

	switch ack.CommandID {
	case transfer.RevokeCommandID:
		if did != transfer.FromDeviceID {
			return transfer, ErrInvalidDeviceID
		}
		transfer.RevokeAcked = true
		transfer.Phase = TransferOldOutputRevoked
		_, _ = r.SetOutputState(ctx, uid, did, OutputStateRevoked, transfer.ActiveRevision)
	case transfer.ActivateCommandID:
		if did != transfer.ToDeviceID {
			return transfer, ErrInvalidDeviceID
		}
		transfer.ActivateAcked = true
		transfer.Phase = TransferNewOutputActivated
		_, _ = r.SetOutputState(ctx, uid, did, OutputStateActive, transfer.ActiveRevision)
	default:
		return transfer, ErrInvalidCommandPayload
	}
	if transfer.RevokeAcked && transfer.ActivateAcked {
		transfer.Phase = TransferReconciled
		_ = r.rdb.Del(ctx, r.keyActiveTransfer(uid)).Err()
		_ = r.rdb.SRem(ctx, r.keyTransfersActive(), transfer.TransferID).Err()
		if r.m != nil {
			r.m.Reconcile.WithLabelValues("transfer_reconciled").Inc()
		}
	}
	if err := r.saveTransfer(ctx, transfer); err != nil {
		return nil, err
	}
	r.publishTransferUpdateWithPlayerState(ctx, uid, transfer)
	return transfer, nil
}

func (r *Registry) HandleOutputReport(ctx context.Context, userID string, report OutputReport) (*OutputLease, error) {
	lease, err := r.SetOutputState(ctx, userID, report.DeviceID, report.State, report.ActiveRevision)
	if err != nil {
		return lease, err
	}
	uid, err := r.normalizeUserID(userID)
	if err != nil {
		return lease, err
	}
	r.publishPlayerState(ctx, uid)
	return lease, nil
}
