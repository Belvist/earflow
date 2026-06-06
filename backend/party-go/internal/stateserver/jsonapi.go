package stateserver

import (
	"time"

	"github.com/earflow/music-platform/party-go/internal/party"
)

// buildGetParty mirrors party-service GET /api/party/:id for the web client.
func buildGetParty(doc *party.PartyDoc, userID string) map[string]any {
	nowMs := time.Now().UnixMilli()
	doc = party.SnapshotDoc(doc, nowMs)
	isHost := doc.HostID == userID
	_, isParticipant := doc.Participants[userID]
	var pos float64
	if doc.Playback.PositionMs >= 0 {
		pos = float64(doc.Playback.PositionMs) / 1000.0
	}
	trackID := any(nil)
	if doc.Playback.TrackID != nil {
		trackID = *doc.Playback.TrackID
	}
	st := map[string]any{
		"trackId":         trackID,
		"isPlaying":       doc.Playback.IsPlaying,
		"position":        pos,
		"stateRevision":   doc.Rev,
		"serverTimestamp": nowMs,
		"trackDuration":   float64(doc.Playback.TrackDuration) / 1000.0,
	}
	if doc.Playback.TrackTitle != nil {
		st["trackTitle"] = *doc.Playback.TrackTitle
	}
	if doc.Playback.TrackArtist != nil {
		st["trackArtist"] = *doc.Playback.TrackArtist
	}
	if doc.Playback.TrackCover != nil {
		st["trackCover"] = *doc.Playback.TrackCover
	}
	if doc.Playback.TrackDuration == 0 {
		st["trackDuration"] = 0.0
	}

	perms := map[string]any{
		"guestsCanChangePlayback":  doc.Permissions.GuestsCanPlayPause,
		"guestsCanAddToQueue":      doc.Permissions.GuestsCanAddToQueue,
		"guestsCanSkip":            doc.Permissions.GuestsCanSkip,
		"guestsCanRemoveFromQueue": doc.Permissions.GuestsCanRemoveFromQueue,
		"guestsCanPlayPause":       doc.Permissions.GuestsCanPlayPause,
		"guestsCanSeek":            doc.Permissions.GuestsCanSeek,
	}

	parr := make([]any, 0, len(doc.Participants))
	for _, p := range doc.Participants {
		parr = append(parr, map[string]any{
			"userId": p.UserID, "username": p.Username, "isHost": p.IsHost, "joinedAt": p.JoinedAtMs,
		})
	}
	q := make([]any, 0, len(doc.Queue))
	for _, it := range doc.Queue {
		cover := any(nil)
		if it.Cover != nil {
			cover = *it.Cover
		}
		q = append(q, map[string]any{
			"queueId": it.QueueID, "id": it.ID, "title": it.Title, "artist": it.Artist, "cover": cover,
			"duration": it.DurationMs / 1000, "addedBy": it.AddedBy, "addedByName": it.AddedByName,
		})
	}
	return map[string]any{
		"party": map[string]any{
			"id":               doc.ID,
			"title":            doc.Title,
			"description":      doc.Description,
			"isPrivate":        doc.IsPrivate,
			"maxParticipants":  doc.MaxParticipants,
			"participantCount": len(doc.Participants),
			"hostId":           doc.HostID,
			"hostName":         doc.HostName,
			"createdAt":        time.UnixMilli(doc.CreatedAtMs).UTC().Format(time.RFC3339),
		},
		"state":         st,
		"queue":         q,
		"participants":  parr,
		"permissions":   perms,
		"isParticipant": isParticipant,
		"isHost":        isHost,
	}
}
