package search

type Request struct {
	Query    string
	Limit    int
	Offset   int
	IsAuthed bool
}

type Response struct {
	Query     string   `json:"query"`
	Normalized string  `json:"normalizedQuery"`
	Tracks    []Track  `json:"tracks"`
	Artists   []Artist `json:"artists"`
	Albums    []Album  `json:"albums"`
	Recommendations []Track `json:"recommendations"`
	Meta      Meta     `json:"meta"`
}

type Track struct {
	ID         int64   `json:"id"`
	PublicID   *string `json:"public_id,omitempty"`
	Title      string  `json:"title"`
	Artist     string `json:"artist"`
	Album      string `json:"album"`
	Duration   *int   `json:"duration"`
	Genre      *string `json:"genre"`
	Year       *int   `json:"year"`
	CoverPath  *string `json:"cover_path"`
	HasEbap    bool   `json:"has_ebap"`
	PlayCount  int    `json:"play_count"`
	Popularity int    `json:"popularity"`
}

type Artist struct {
	ArtistName     string  `json:"artistName"`
	ArtistPublicId *string `json:"artistPublicId"`
	IsVerified     bool    `json:"isVerified"`
	TrackCount     int     `json:"trackCount"`
	TotalPlays     *int64  `json:"totalPlays"`
	HeroCoverPath  *string `json:"heroCoverPath"`
}

type Album struct {
	AlbumName      string  `json:"albumName"`
	AlbumPublicId  *string `json:"albumPublicId"`
	ArtistName     string  `json:"artistName"`
	ArtistPublicId *string `json:"artistPublicId"`
	TrackCount     int     `json:"trackCount"`
	TotalPlays     *int64  `json:"totalPlays"`
	Year           *int    `json:"year"`
	HeroCoverPath  *string `json:"heroCoverPath"`
}

type Meta struct {
	UsedFallbackQuery *string `json:"usedFallbackQuery"`
	Alternatives      []string `json:"alternatives"`
}
