package party

import (
	"encoding/json"
	"testing"
)

func TestPartyDocUnmarshalAcceptsLegacyNumericPlaybackAndArrayParticipants(t *testing.T) {
	raw := []byte(`{
		"v": "1",
		"id": "party-1",
		"title": "Session",
		"isPrivate": "true",
		"hostId": 24,
		"hostName": "Host",
		"createdAt": 1710000000,
		"permissions": {
			"guestsCanChangePlayback": "true",
			"guestsCanAddToQueue": 1
		},
		"playback": {
			"trackId": 119,
			"isPlaying": "true",
			"position": 4.5,
			"serverTimestamp": 1710000100000,
			"trackDuration": 180
		},
		"participants": [
			{ "id": 24, "username": "Host", "isHost": true, "joinedAt": 1710000000 }
		],
		"queue": [
			{ "queueId": "q-1", "trackId": 7, "title": "Next", "artist": "Artist", "duration": 123 }
		],
		"maxParticipants": "50"
	}`)

	var doc PartyDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("json.Unmarshal returned error: %v", err)
	}
	if doc.HostID != "24" {
		t.Fatalf("HostID = %q, want 24", doc.HostID)
	}
	if doc.Playback.TrackID == nil || *doc.Playback.TrackID != "119" {
		t.Fatalf("TrackID = %#v, want 119", doc.Playback.TrackID)
	}
	if doc.Playback.PositionMs != 4500 {
		t.Fatalf("PositionMs = %d, want 4500", doc.Playback.PositionMs)
	}
	if doc.Playback.TrackDuration != 180000 {
		t.Fatalf("TrackDuration = %d, want 180000", doc.Playback.TrackDuration)
	}
	if _, ok := doc.Participants["24"]; !ok {
		t.Fatalf("participants missing host: %#v", doc.Participants)
	}
	if len(doc.Queue) != 1 || doc.Queue[0].QueueID != "q-1" || doc.Queue[0].ID != "7" || doc.Queue[0].DurationMs != 123000 {
		t.Fatalf("queue = %#v, want one normalized item", doc.Queue)
	}
}

func TestPartyDocUnmarshalAcceptsObjectParticipantsAndNulls(t *testing.T) {
	raw := []byte(`{
		"id": "party-2",
		"title": "Session",
		"hostId": "u1",
		"participants": {
			"u1": { "username": "Host", "isHost": true }
		},
		"queue": null,
		"playback": { "trackId": null, "positionMs": "2000" }
	}`)

	var doc PartyDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("json.Unmarshal returned error: %v", err)
	}
	if got := doc.Participants["u1"].UserID; got != "u1" {
		t.Fatalf("participant UserID = %q, want u1", got)
	}
	if doc.Queue == nil || len(doc.Queue) != 0 {
		t.Fatalf("Queue = %#v, want empty slice", doc.Queue)
	}
	if doc.Playback.TrackID != nil {
		t.Fatalf("TrackID = %#v, want nil", doc.Playback.TrackID)
	}
}
