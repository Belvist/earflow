package devices

// Device is one registered user device. Wire format = exact JSON we send to
// clients.
type Device struct {
	ID           string              `json:"id"`
	UserID       string              `json:"userId,omitempty"`
	Name         string              `json:"name"`
	Kind         string              `json:"kind"`
	UserAgent    string              `json:"userAgent,omitempty"`
	IP           string              `json:"ip,omitempty"`
	CreatedAt    int64               `json:"createdAt"`
	LastSeenAt   int64               `json:"lastSeenAt"`
	SessionID    string              `json:"sessionId,omitempty"`
	Capabilities *DeviceCapabilities `json:"capabilities,omitempty"`
	// ClientKey — внутренняя метка (Redis), не уходит в JSON.
	ClientKey string `json:"-"`
	IsActive  bool   `json:"isActive"`
}

type DeviceCapabilities struct {
	Platform        string   `json:"platform,omitempty"`
	BackgroundAudio bool     `json:"backgroundAudio"`
	OutputModes     []string `json:"outputModes,omitempty"`
	NativeVersion   string   `json:"nativeVersion,omitempty"`
}

const NowPlayingRejectReasonStale = "STALE_WRITE"
const NowPlayingRejectReasonStaleRevision = "STALE_REVISION"

const (
	CommandPause       = "pause"
	CommandTransfer    = "transfer"
	CommandRevokeAudio = "revoke_audio"
)

// NowPlaying is the single playback truth for a user.
type NowPlaying struct {
	TrackID         string `json:"trackId,omitempty"`
	Title           string `json:"title,omitempty"`
	Artist          string `json:"artist,omitempty"`
	Cover           string `json:"cover,omitempty"`
	DurationSec     int64  `json:"durationSec"`
	IsPlaying       bool   `json:"isPlaying"`
	PositionSec     int64  `json:"positionSec"`
	UpdatedAtMs     int64  `json:"updatedAtMs"`
	DeviceID        string `json:"deviceId,omitempty"`
	StateRevision   int64  `json:"stateRevision"`
	ActiveRevision  int64  `json:"activeRevision,omitempty"`
	QueueSource     string `json:"queueSource,omitempty"`
	QueueName       string `json:"queueName,omitempty"`
	ClientSeq       int64  `json:"clientSeq,omitempty"`
	ClientEventAtMs int64  `json:"clientEventAtMs,omitempty"`
}

// NowPlayingWriteResult is the authoritative result of a now-playing write.
type NowPlayingWriteResult struct {
	NowPlaying     *NowPlaying `json:"nowPlaying"`
	Accepted       bool        `json:"accepted"`
	Reason         string      `json:"reason,omitempty"`
	ActiveRevision int64       `json:"activeRevision,omitempty"`
}

type OutputState string

const (
	OutputStateActive      OutputState = "ACTIVE"
	OutputStateSuspended   OutputState = "SUSPENDED"
	OutputStateBuffering   OutputState = "BUFFERING"
	OutputStateInterrupted OutputState = "INTERRUPTED"
	OutputStateRevoked     OutputState = "REVOKED"
	OutputStateLost        OutputState = "LOST"
	OutputStateError       OutputState = "ERROR"
)

type PlaybackTimeline struct {
	TrackID       string `json:"trackId,omitempty"`
	Title         string `json:"title,omitempty"`
	Artist        string `json:"artist,omitempty"`
	Cover         string `json:"cover,omitempty"`
	DurationSec   int64  `json:"durationSec"`
	IsPlaying     bool   `json:"isPlaying"`
	PositionSec   int64  `json:"positionSec"`
	UpdatedAtMs   int64  `json:"updatedAtMs"`
	StateRevision int64  `json:"stateRevision"`
	QueueSource   string `json:"queueSource,omitempty"`
	QueueName     string `json:"queueName,omitempty"`
}

type OutputLease struct {
	HolderDeviceID string                 `json:"holderDeviceId,omitempty"`
	ActiveRevision int64                  `json:"activeRevision"`
	LeaseRevision  int64                  `json:"leaseRevision"`
	UpdatedAtMs    int64                  `json:"updatedAtMs"`
	DeviceStates   map[string]OutputState `json:"deviceStates"`
}

type TransferPhase string

const (
	TransferRequested          TransferPhase = "requested"
	TransferRevokeSent         TransferPhase = "revoke_sent"
	TransferOldOutputRevoked   TransferPhase = "old_output_revoked"
	TransferNewOutputActivated TransferPhase = "new_output_activated"
	TransferReconciled         TransferPhase = "reconciled"
	TransferExpired            TransferPhase = "expired"
	TransferFailed             TransferPhase = "failed"
)

type TransferRecord struct {
	TransferID        string            `json:"transferId"`
	UserID            string            `json:"userId,omitempty"`
	FromDeviceID      string            `json:"fromDeviceId,omitempty"`
	ToDeviceID        string            `json:"toDeviceId"`
	Phase             TransferPhase     `json:"phase"`
	ActiveRevision    int64             `json:"activeRevision"`
	Resume            bool              `json:"resume"`
	IdempotencyKey    string            `json:"idempotencyKey,omitempty"`
	TimelineSnapshot  *PlaybackTimeline `json:"timeline,omitempty"`
	CreatedAtMs       int64             `json:"createdAtMs"`
	UpdatedAtMs       int64             `json:"updatedAtMs"`
	ExpiresAtMs       int64             `json:"expiresAtMs"`
	LastError         string            `json:"lastError,omitempty"`
	RevokeCommandID   string            `json:"revokeCommandId,omitempty"`
	ActivateCommandID string            `json:"activateCommandId,omitempty"`
	RetryCount        int               `json:"retryCount"`
	RevokeAcked       bool              `json:"revokeAcked"`
	ActivateAcked     bool              `json:"activateAcked"`
}

type CmdAck struct {
	Type           string `json:"type"`
	TransferID     string `json:"transferId,omitempty"`
	CommandID      string `json:"commandId"`
	DeviceID       string `json:"deviceId"`
	Cmd            string `json:"cmd"`
	Step           string `json:"step,omitempty"`
	Ok             bool   `json:"ok"`
	Reason         string `json:"reason,omitempty"`
	ActiveRevision int64  `json:"activeRevision,omitempty"`
	At             int64  `json:"at"`
}

type OutputReport struct {
	DeviceID       string      `json:"deviceId"`
	State          OutputState `json:"state"`
	ActiveRevision int64       `json:"activeRevision,omitempty"`
	At             int64       `json:"at"`
	Reason         string      `json:"reason,omitempty"`
}

// Command is the payload published over Redis Pub/Sub and forwarded to
// sockets. Empty `To` means broadcast to every socket of the user.
type Command struct {
	Type    string                 `json:"type"` // always "cmd"
	From    *string                `json:"from"` // nil = server-originated
	To      *string                `json:"to"`   // nil = broadcast
	Cmd     string                 `json:"cmd"`
	Payload map[string]interface{} `json:"payload"`
	At      int64                  `json:"at"`
}

// Event is anything published on the user channel; clients treat unknown
// types as no-ops, so it is safe to add new types server-side.
type Event struct {
	Type             string            `json:"type"`
	At               int64             `json:"at"`
	DeviceID         *string           `json:"deviceId,omitempty"`
	PreviousActiveID *string           `json:"previousActiveId,omitempty"`
	ActiveRevision   int64             `json:"activeRevision,omitempty"`
	State            *NowPlaying       `json:"state,omitempty"`
	Timeline         *PlaybackTimeline `json:"timeline,omitempty"`
	Lease            *OutputLease      `json:"lease,omitempty"`
	Transfer         *TransferRecord   `json:"transfer,omitempty"`

	// Command-specific
	From    *string                `json:"from,omitempty"`
	To      *string                `json:"to,omitempty"`
	Cmd     string                 `json:"cmd,omitempty"`
	Payload map[string]interface{} `json:"payload,omitempty"`
}
