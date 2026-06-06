package devices

import (
	"context"
	"log/slog"
	"time"
)

func (r *Registry) RunTransferWorker(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.retryDueTransfers(ctx)
		}
	}
}

func (r *Registry) retryDueTransfers(ctx context.Context) {
	ids, err := r.rdb.SMembers(ctx, r.keyTransfersActive()).Result()
	if err != nil {
		r.log.Debug("transfer worker scan failed", slog.Any("err", err))
		return
	}
	nowMs := time.Now().UnixMilli()
	for _, id := range ids {
		transfer, err := r.GetTransfer(ctx, id)
		if err != nil {
			_ = r.rdb.SRem(ctx, r.keyTransfersActive(), id).Err()
			continue
		}
		if transfer.Phase == TransferReconciled || transfer.Phase == TransferFailed || transfer.Phase == TransferExpired {
			_ = r.rdb.SRem(ctx, r.keyTransfersActive(), id).Err()
			continue
		}
		if nowMs-transfer.UpdatedAtMs < r.cfg.Transfer.AckTimeout.Milliseconds() {
			continue
		}
		if transfer.RetryCount >= r.cfg.Transfer.MaxRetries {
			transfer.Phase = TransferExpired
			transfer.LastError = "ACK_TIMEOUT"
			transfer.UpdatedAtMs = nowMs
			_ = r.saveTransfer(ctx, transfer)
			_ = r.rdb.SRem(ctx, r.keyTransfersActive(), id).Err()
			if r.m != nil {
				r.m.TransferFailed.Inc()
			}
			r.publishTransferUpdate(ctx, transfer.UserID, transfer)
			continue
		}
		transfer.RetryCount++
		transfer.UpdatedAtMs = nowMs
		r.republishTransferCommands(ctx, transfer)
		_ = r.saveTransfer(ctx, transfer)
		r.publishTransferUpdate(ctx, transfer.UserID, transfer)
	}
}

func (r *Registry) republishTransferCommands(ctx context.Context, transfer *TransferRecord) {
	if transfer == nil {
		return
	}
	deadlineMs := time.Now().Add(r.cfg.Transfer.AckTimeout).UnixMilli()
	if !transfer.RevokeAcked && transfer.FromDeviceID != "" && transfer.FromDeviceID != transfer.ToDeviceID {
		r.publish(ctx, transfer.UserID, Event{
			Type: "cmd",
			At:   time.Now().UnixMilli(),
			From: nil,
			To:   strPtr(transfer.FromDeviceID),
			Cmd:  CommandRevokeAudio,
			Payload: map[string]interface{}{
				"reason":         "transfer_retry",
				"activeDeviceId": transfer.ToDeviceID,
				"activeRevision": transfer.ActiveRevision,
				"timeline":       transfer.TimelineSnapshot,
				"transferId":     transfer.TransferID,
				"commandId":      transfer.RevokeCommandID,
				"step":           transferStepRevoke,
				"deadlineMs":     deadlineMs,
			},
		})
	}
	if !transfer.ActivateAcked {
		r.publish(ctx, transfer.UserID, Event{
			Type: "cmd",
			At:   time.Now().UnixMilli(),
			From: nil,
			To:   strPtr(transfer.ToDeviceID),
			Cmd:  CommandTransfer,
			Payload: map[string]interface{}{
				"activeDeviceId": transfer.ToDeviceID,
				"activeRevision": transfer.ActiveRevision,
				"resume":         transfer.Resume,
				"timeline":       transfer.TimelineSnapshot,
				"transferId":     transfer.TransferID,
				"commandId":      transfer.ActivateCommandID,
				"step":           transferStepActivate,
				"deadlineMs":     deadlineMs,
			},
		})
	}
}
