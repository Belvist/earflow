package party

// ProjectPlaybackPositionMs returns the position clients should see at nowMs.
// Redis stores the last committed position plus the time it was updated; while
// playback is running snapshots must project that value forward.
func ProjectPlaybackPositionMs(pb PlaybackState, nowMs int64) int64 {
	pos := pb.PositionMs
	if pos < 0 {
		pos = 0
	}
	if pb.IsPlaying && pb.PositionUpdatedAtMs > 0 && nowMs > pb.PositionUpdatedAtMs {
		pos += nowMs - pb.PositionUpdatedAtMs
	}
	if pb.TrackDuration > 0 && pos > pb.TrackDuration {
		pos = pb.TrackDuration
	}
	return pos
}

// SnapshotDoc returns a shallow copy with playback projected to nowMs. It is
// for outbound REST/WS snapshots only; it must not be written back to Redis.
func SnapshotDoc(doc *PartyDoc, nowMs int64) *PartyDoc {
	if doc == nil {
		return nil
	}
	cp := *doc
	cp.Playback.PositionMs = ProjectPlaybackPositionMs(doc.Playback, nowMs)
	if cp.Playback.IsPlaying {
		cp.Playback.PositionUpdatedAtMs = nowMs
	}
	return &cp
}
