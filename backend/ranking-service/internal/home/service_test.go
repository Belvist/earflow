package home

import (
	"testing"
	"time"
)

func TestBuildRailsReturnsSeparateVisibleSections(t *testing.T) {
	svc := &Service{cfg: Config{MaxRails: 5, MaxPlaylists: 8, TrackLimit: 5}}
	candidates := make([]candidate, 0, 45)
	for i := 1; i <= 45; i++ {
		genre := "genre"
		artist := "artist"
		if i%3 == 0 {
			genre = "fresh"
		}
		if i%5 == 0 {
			artist = "liked"
		}
		if i%5 != 0 {
			artist = "artist-" + itoa(i%17)
		}
		var releaseDate *time.Time
		if i > 35 {
			v := testNow().AddDate(0, 0, -1)
			releaseDate = &v
		}
		candidates = append(candidates, candidate{
			Track:       Track{ID: i, Artist: artist, Genre: &genre},
			ReleaseDate: releaseDate,
			Liked:       i%5 == 0,
			BaseScore:   float64(100 - i),
		})
	}
	profile := buildTasteProfile(candidates)
	scoreCandidates(candidates, profile, testNow())

	rails, fallbackUsed := svc.buildRails("seed", candidates, profile, testNow())
	if fallbackUsed {
		t.Fatal("fallback used for populated candidates")
	}
	if len(rails) < 3 {
		t.Fatalf("rails len = %d, want at least 3: %+v", len(rails), rails)
	}
	seen := map[string]bool{}
	for _, rail := range rails {
		seen[rail.ID] = true
		if len(rail.Playlists) == 0 {
			t.Fatalf("rail %s has no playlists", rail.ID)
		}
	}
	for _, want := range []string{"for_you", "discovery", "fresh"} {
		if !seen[want] {
			t.Fatalf("missing rail %q in %+v", want, rails)
		}
	}
}

func TestBuildRailsDoesNotLetForYouConsumeWholeHome(t *testing.T) {
	svc := &Service{cfg: Config{MaxRails: 5, MaxPlaylists: 8, TrackLimit: 8}}
	candidates := make([]candidate, 0, 24)
	for i := 1; i <= 24; i++ {
		genre := "rap"
		if i%4 == 0 {
			genre = "pop"
		}
		candidates = append(candidates, candidate{
			Track: Track{
				ID:     i,
				Artist: "artist-" + itoa(i%7),
				Genre:  &genre,
			},
			Liked:     i%5 == 0,
			BaseScore: float64(100 - i),
		})
	}
	profile := buildTasteProfile(candidates)
	scoreCandidates(candidates, profile, testNow())

	rails, fallbackUsed := svc.buildRails("seed", candidates, profile, testNow())
	if fallbackUsed {
		t.Fatal("fallback used for normal candidate pool")
	}
	if len(rails) < 2 {
		t.Fatalf("rails len = %d, want at least 2: %+v", len(rails), rails)
	}
	if rails[0].ID != "for_you" {
		t.Fatalf("first rail = %q, want for_you", rails[0].ID)
	}
	if !hasRail(rails, "discovery") {
		t.Fatalf("missing discovery rail after for_you: %+v", rails)
	}
}

func TestBuildRailsFillsPlaylistBudgetWhenCatalogHasEnoughTracks(t *testing.T) {
	svc := &Service{cfg: Config{MaxRails: 5, MaxPlaylists: 8, TrackLimit: 5}}
	candidates := make([]candidate, 0, 80)
	for i := 1; i <= 80; i++ {
		genre := "genre-" + itoa(i%9)
		candidates = append(candidates, candidate{
			Track: Track{
				ID:     i,
				Artist: "artist-" + itoa(i%23),
				Genre:  &genre,
			},
			Liked:     i%6 == 0,
			BaseScore: float64(1000 - i),
		})
	}
	profile := buildTasteProfile(candidates)
	scoreCandidates(candidates, profile, testNow())

	rails, fallbackUsed := svc.buildRails("seed", candidates, profile, testNow())
	if fallbackUsed {
		t.Fatal("fallback used for normal candidate pool")
	}
	if got := playlistCount(rails); got > 8 {
		t.Fatalf("playlist count = %d, want no more than 8: %+v", got, rails)
	}
	if !hasRail(rails, "discovery") {
		t.Fatalf("missing discovery rail after semantic selection: %+v", rails)
	}
	if !hasRail(rails, "popular") {
		t.Fatalf("missing popular rail after semantic selection: %+v", rails)
	}
}

func TestBuildRailsUsesExpandedHomeBudget(t *testing.T) {
	svc := &Service{cfg: Config{MaxRails: 6, MaxPlaylists: 60, PlaylistsPerRail: 10, TrackLimit: 8}}
	candidates := make([]candidate, 0, 500)
	for i := 1; i <= 500; i++ {
		genre := "genre-" + itoa(i%12)
		candidates = append(candidates, candidate{
			Track: Track{
				ID:     i,
				Artist: "artist-" + itoa(i%37),
				Genre:  &genre,
			},
			Liked:     i%9 == 0,
			BaseScore: float64(2000 - i),
		})
	}
	profile := buildTasteProfile(candidates)
	scoreCandidates(candidates, profile, testNow())

	rails, fallbackUsed := svc.buildRails("seed", candidates, profile, testNow())
	if fallbackUsed {
		t.Fatal("fallback used for normal candidate pool")
	}
	if got := playlistCount(rails); got < 20 {
		t.Fatalf("playlist count = %d, want at least 20: %+v", got, rails)
	}
	if !hasRail(rails, "popular") {
		t.Fatalf("missing popular rail with expanded budget: %+v", rails)
	}
	if !hasRail(rails, "discovery") {
		t.Fatalf("missing discovery rail with expanded budget: %+v", rails)
	}
}

func TestBuildRailsDoesNotFakeComebackWithoutHistory(t *testing.T) {
	svc := &Service{cfg: Config{MaxRails: 6, MaxPlaylists: 60, PlaylistsPerRail: 10, TrackLimit: 8}}
	candidates := make([]candidate, 0, 180)
	for i := 1; i <= 180; i++ {
		genre := "genre-" + itoa(i%9)
		candidates = append(candidates, candidate{
			Track: Track{
				ID:     i,
				Artist: "artist-" + itoa(i%25),
				Genre:  &genre,
			},
			BaseScore: float64(1000 - i),
		})
	}
	profile := buildTasteProfile(candidates)
	scoreCandidates(candidates, profile, testNow())

	rails, fallbackUsed := svc.buildRails("seed", candidates, profile, testNow())
	if fallbackUsed {
		t.Fatal("fallback used for normal candidate pool")
	}
	if hasRail(rails, "comeback") {
		t.Fatalf("comeback rail returned without user history: %+v", rails)
	}
}

func TestBuildRailsDoesNotRepeatTracksAcrossPlaylists(t *testing.T) {
	svc := &Service{cfg: Config{MaxRails: 6, MaxPlaylists: 60, PlaylistsPerRail: 10, TrackLimit: 8}}
	candidates := make([]candidate, 0, 260)
	for i := 1; i <= 260; i++ {
		genre := "genre-" + itoa(i%14)
		createdAt := testNow().AddDate(0, 0, -(i % 120))
		candidates = append(candidates, candidate{
			Track: Track{
				ID:     i,
				Artist: "artist-" + itoa(i%41),
				Genre:  &genre,
			},
			CreatedAt: createdAt,
			Liked:     i%11 == 0,
			BaseScore: float64(2000 - i),
		})
	}
	profile := buildTasteProfile(candidates)
	scoreCandidates(candidates, profile, testNow())

	rails, fallbackUsed := svc.buildRails("seed", candidates, profile, testNow())
	if fallbackUsed {
		t.Fatal("fallback used for normal candidate pool")
	}
	seen := map[int]string{}
	for _, rail := range rails {
		for _, playlist := range rail.Playlists {
			for _, track := range playlist.Tracks {
				if prev, ok := seen[track.ID]; ok {
					t.Fatalf("track %d repeated in %s after %s", track.ID, playlist.ID, prev)
				}
				seen[track.ID] = playlist.ID
			}
		}
	}
}

func TestSelectBucketExcludesRealtimeDislikesFromBackfill(t *testing.T) {
	profile := tasteProfile{Artists: map[string]float64{}, Genres: map[string]float64{}, Cold: true}
	used := map[int]struct{}{}
	items := []candidate{
		{Track: Track{ID: 1, Artist: "blocked"}, BaseScore: 100, DislikedRealtime: true},
		{Track: Track{ID: 2, Artist: "alpha"}, BaseScore: 80},
		{Track: Track{ID: 3, Artist: "beta"}, BaseScore: 70},
	}

	got := selectBucket(items, profile, used, bucketPolicy{Discovery: 100}, 3)
	for _, item := range got {
		if item.ID == 1 {
			t.Fatalf("realtime disliked track returned in bucket: %+v", got)
		}
	}
}

func TestBuildRailsOmitsFreshWithoutWeeklyReleaseDates(t *testing.T) {
	svc := &Service{cfg: Config{MaxRails: 5, MaxPlaylists: 8, TrackLimit: 5}}
	oldRelease := testNow().AddDate(0, 0, -8)
	candidates := make([]candidate, 0, 30)
	for i := 1; i <= 30; i++ {
		var releaseDate *time.Time
		if i <= 10 {
			releaseDate = &oldRelease
		}
		candidates = append(candidates, candidate{
			Track:       Track{ID: i, Artist: "artist"},
			ReleaseDate: releaseDate,
			BaseScore:   float64(100 - i),
		})
	}
	profile := buildTasteProfile(candidates)
	scoreCandidates(candidates, profile, testNow())

	rails, _ := svc.buildRails("seed", candidates, profile, testNow())
	if hasRail(rails, "fresh") {
		t.Fatalf("fresh rail returned without weekly release dates: %+v", rails)
	}
}

func TestSelectWeeklyFreshExcludesRealtimeDislikes(t *testing.T) {
	releaseDate := testNow().AddDate(0, 0, -1)
	items := []candidate{
		{Track: Track{ID: 1, Artist: "blocked"}, ReleaseDate: &releaseDate, BaseScore: 100, DislikedRealtime: true},
		{Track: Track{ID: 2, Artist: "alpha"}, ReleaseDate: &releaseDate, BaseScore: 90},
		{Track: Track{ID: 3, Artist: "beta"}, ReleaseDate: &releaseDate, BaseScore: 80},
		{Track: Track{ID: 4, Artist: "gamma"}, ReleaseDate: &releaseDate, BaseScore: 70},
		{Track: Track{ID: 5, Artist: "delta"}, ReleaseDate: &releaseDate, BaseScore: 60},
	}

	got := selectWeeklyFresh(items, map[int]struct{}{}, 5, testNow())
	for _, item := range got {
		if item.ID == 1 {
			t.Fatalf("realtime disliked fresh track returned: %+v", got)
		}
	}
}

func TestAppendDiversePrefersDistinctCovers(t *testing.T) {
	sameCover := "covers/same.webp"
	items := make([]candidate, 0, 10)
	for i := 1; i <= 5; i++ {
		cover := sameCover
		items = append(items, candidate{
			Track: Track{ID: i, Artist: "artist-" + itoa(i), CoverPath: &cover},
		})
	}
	for i := 6; i <= 10; i++ {
		cover := "covers/" + itoa(i) + ".webp"
		items = append(items, candidate{
			Track: Track{ID: i, Artist: "artist-" + itoa(i), CoverPath: &cover},
		})
	}

	got := appendDiverse(nil, items, map[int]struct{}{}, 5, 5)
	if len(got) != 5 {
		t.Fatalf("len = %d, want 5: %+v", len(got), got)
	}

	coverCounts := map[string]int{}
	for _, item := range got {
		coverCounts[normalizeKey(ptrString(item.CoverPath))]++
	}
	if coverCounts[normalizeKey(sameCover)] > 1 {
		t.Fatalf("same cover repeated in first pass: %+v", got)
	}
}

func TestDiagnosticsBucketCountsNormalizeReasonTypes(t *testing.T) {
	counts := bucketCounts([]Playlist{
		{Context: map[string]any{"reason_type": "exact_taste"}, Tracks: []Track{{ID: 1}, {ID: 2}}},
		{Context: map[string]any{"reason_type": "near_taste"}, Tracks: []Track{{ID: 3}}},
		{Context: map[string]any{"reason_type": "cold_start"}, Tracks: []Track{{ID: 4}, {ID: 5}, {ID: 6}}},
	})

	if counts["exact"] != 2 {
		t.Fatalf("exact count = %d, want 2", counts["exact"])
	}
	if counts["near"] != 1 {
		t.Fatalf("near count = %d, want 1", counts["near"])
	}
	if counts["cold_start"] != 3 {
		t.Fatalf("cold_start count = %d, want 3", counts["cold_start"])
	}
}

func testNow() time.Time {
	return time.Date(2026, 5, 10, 12, 0, 0, 0, time.UTC)
}

func hasRail(rails []Rail, id string) bool {
	for _, rail := range rails {
		if rail.ID == id {
			return true
		}
	}
	return false
}

func playlistCount(rails []Rail) int {
	total := 0
	for _, rail := range rails {
		total += len(rail.Playlists)
	}
	return total
}
