package home

import "time"

type Request struct {
	UserID int    `json:"userId"`
	Seed   string `json:"seed"`
	Limit  int    `json:"limit"`
}

type Response struct {
	Seed        string      `json:"seed"`
	Rails       []Rail      `json:"rails"`
	Source      string      `json:"-"`
	CacheStatus string      `json:"-"`
	Diagnostics Diagnostics `json:"-"`
}

type Diagnostics struct {
	FallbackUsed   bool
	BucketCounts   map[string]int
	RealtimeCounts map[string]int
}

type Rail struct {
	ID          string     `json:"id"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Playlists   []Playlist `json:"playlists"`
}

type Playlist struct {
	ID          string         `json:"id"`
	Type        string         `json:"type"`
	Title       string         `json:"title"`
	Description string         `json:"description"`
	CoverURL    *string        `json:"coverUrl"`
	Tracks      []Track        `json:"tracks"`
	TrackCount  int            `json:"trackCount"`
	ShareToken  *string        `json:"shareToken"`
	IsFeatured  bool           `json:"isFeatured"`
	Context     map[string]any `json:"context,omitempty"`
}

type Track struct {
	ID        int     `json:"id"`
	Title     string  `json:"title"`
	Artist    string  `json:"artist"`
	Album     *string `json:"album"`
	Duration  *int    `json:"duration"`
	Genre     *string `json:"genre"`
	Year      *int    `json:"year"`
	CoverPath *string `json:"cover_path"`
	HasEBAP   bool    `json:"has_ebap"`
}

type candidate struct {
	Track
	CreatedAt        time.Time
	ReleaseDate      *time.Time
	Popularity       float64
	PlayCount        float64
	Plays30d         float64
	UserPlayCount    int
	UserSkipCount    int
	TotalPlayTime    int
	Liked            bool
	LikeEvent        bool
	LastPlayed       *time.Time
	Tempo            *float64
	Energy           *float64
	SeenToday        bool
	RecentRealtime   bool
	SkippedRealtime  bool
	DislikedRealtime bool
	BaseScore        float64
}
