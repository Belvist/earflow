package party

import "testing"

func TestProjectPlaybackPositionMsProjectsRunningTrack(t *testing.T) {
	got := ProjectPlaybackPositionMs(PlaybackState{
		IsPlaying:           true,
		PositionMs:          10_000,
		PositionUpdatedAtMs: 100_000,
		TrackDuration:       60_000,
	}, 112_500)

	if got != 22_500 {
		t.Fatalf("position = %d, want 22500", got)
	}
}

func TestProjectPlaybackPositionMsClampsToDuration(t *testing.T) {
	got := ProjectPlaybackPositionMs(PlaybackState{
		IsPlaying:           true,
		PositionMs:          58_000,
		PositionUpdatedAtMs: 100_000,
		TrackDuration:       60_000,
	}, 110_000)

	if got != 60_000 {
		t.Fatalf("position = %d, want 60000", got)
	}
}

func TestSnapshotDocDoesNotMutateInput(t *testing.T) {
	doc := &PartyDoc{
		ID: "p1",
		Playback: PlaybackState{
			IsPlaying:           true,
			PositionMs:          1_000,
			PositionUpdatedAtMs: 10_000,
		},
	}

	snap := SnapshotDoc(doc, 12_000)
	if snap == nil {
		t.Fatal("snapshot is nil")
	}
	if snap.Playback.PositionMs != 3_000 {
		t.Fatalf("snapshot position = %d, want 3000", snap.Playback.PositionMs)
	}
	if doc.Playback.PositionMs != 1_000 {
		t.Fatalf("input position mutated to %d", doc.Playback.PositionMs)
	}
}
