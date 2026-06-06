package stateserver

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/earflow/music-platform/party-go/internal/party"
	"github.com/earflow/music-platform/party-go/internal/wire"
	"github.com/nats-io/nats.go"
)

// StartNATSWorker consumes party.v2.cmd.* with queue group party-v2-state.
func (h *Handler) StartNATSWorker(ctx context.Context, nc *nats.Conn, log *slog.Logger) {
	if nc == nil {
		return
	}
	_, err := nc.QueueSubscribe("party.v2.cmd.*", "party-v2-state", func(m *nats.Msg) {
		h.handleNATS(m, nc, log)
	})
	if err != nil && log != nil {
		log.Error("nats subscribe", slog.Any("err", err))
	}
	go func() {
		<-ctx.Done()
		_ = nc.Drain()
	}()
}

// NATS may carry { t, id, partyId, payload: { cmd: {...} } } or a legacy { cmd: {...} }.
func (h *Handler) handleNATS(m *nats.Msg, nc *nats.Conn, log *slog.Logger) {
	raw, err := wire.DecodeMap(m.Data)
	if err != nil {
		_ = m.Respond(encodeErr("decode"))
		return
	}
	cmd := extractCmd(raw)
	if cmd == nil {
		_ = m.Respond(encodeErr("no_cmd"))
		return
	}
	partyID := partyIDFromCmd(cmd)
	if m.Reply == "" && isPingCmd(cmd) {
		_, _ = h.Store.TouchParty(context.Background(), partyID)
		return
	}
	apply, err := h.Store.ApplyCommand(context.Background(), cmd)
	if err != nil || apply == nil {
		_ = m.Respond(encodeErr("store"))
		return
	}
	if !apply.OK {
		b, _ := wire.Encode(map[string]any{
			"t": "reply", "id": "0", "partyId": partyID, "payload": map[string]any{"ok": false, "code": apply.Code},
		})
		_ = m.Respond(b)
		return
	}
	sh := party.ShardForParty(partyID, h.Cfg.ShardCount)
	if apply.Event != nil {
		evt, _ := jsonRawToAny(apply.Event)
		if evt != nil {
			pub, _ := wire.Encode(map[string]any{"t": "event", "id": "0", "partyId": partyID, "payload": evt})
			_ = nc.Publish(fmt.Sprintf("party.v2.events.%d", sh), pub)
		}
	}
	nowMs := time.Now().UnixMilli()
	docAny, _ := docToMap(apply.Doc, nowMs)
	rep, _ := wire.Encode(map[string]any{
		"t": "reply", "id": "0", "partyId": partyID,
		"payload": map[string]any{"ok": true, "doc": docAny, "serverTimeMs": nowMs},
	})
	_ = m.Respond(rep)
	_ = log
}

func isPingCmd(cmd any) bool {
	c, ok := cmd.(map[string]any)
	if !ok {
		return false
	}
	t, _ := c["type"].(string)
	return t == "ping"
}

func extractCmd(m map[string]any) any {
	if c, ok := m["cmd"]; ok {
		return c
	}
	if p, ok := m["payload"].(map[string]any); ok {
		return p["cmd"]
	}
	return nil
}

func partyIDFromCmd(cmd any) string {
	c, ok := cmd.(map[string]any)
	if !ok {
		return ""
	}
	p, _ := c["partyId"].(string)
	return p
}

func jsonRawToAny(raw json.RawMessage) (any, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var v any
	err := json.Unmarshal(raw, &v)
	return v, err
}

func docToMap(doc *party.PartyDoc, nowMs int64) (any, error) {
	if doc == nil {
		return nil, nil
	}
	doc = party.SnapshotDoc(doc, nowMs)
	b, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	var out any
	_ = json.Unmarshal(b, &out)
	return out, nil
}

func encodeErr(code string) []byte {
	b, _ := wire.Encode(map[string]any{"t": "err", "id": "0", "payload": map[string]any{"ok": false, "code": code}})
	return b
}
