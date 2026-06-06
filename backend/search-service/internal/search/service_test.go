package search

import "testing"

func TestFillDerivedSideResultsRanksQueryMatches(t *testing.T) {
	cover := "covers/platina.webp"
	year := 2025
	resp := Response{
		Tracks: []Track{
			{ID: 1, Title: "Гоблин", Artist: "Платина", Album: "Гоблин", CoverPath: &cover, Year: &year, PlayCount: 10},
			{ID: 2, Title: "Быть богатым feat. Платина", Artist: "Voskresenskii; Платина", Album: "Быть богатым feat. Платина", Year: &year, PlayCount: 5},
			{ID: 3, Title: "Тост", Artist: "PHARAOH; Молодой Платон", Album: "Правило", Year: &year, PlayCount: 1},
		},
	}

	out := fillDerivedSideResults(resp, "плати", 10)
	if len(out.Artists) == 0 {
		t.Fatal("expected derived artists")
	}
	if out.Artists[0].ArtistName != "Платина" {
		t.Fatalf("expected Платина first, got %q", out.Artists[0].ArtistName)
	}
	for _, artist := range out.Artists {
		if artist.ArtistName == "PHARAOH" {
			t.Fatalf("expected unrelated PHARAOH to be filtered out for query match")
		}
	}
	for _, album := range out.Albums {
		if album.AlbumName == "Правило" {
			t.Fatalf("expected unrelated album Правило to be filtered out for query match")
		}
	}
}

func TestDerivedSideResultsMatchTransliteratedQuery(t *testing.T) {
	resp := Response{
		Tracks: []Track{
			{ID: 1, Title: "Гоблин", Artist: "Платина", Album: "Гоблин", PlayCount: 10},
		},
	}

	out := fillDerivedSideResults(resp, "platina", 10)
	if len(out.Artists) != 1 || out.Artists[0].ArtistName != "Платина" {
		t.Fatalf("expected transliterated query to derive Платина, got %#v", out.Artists)
	}
}

func TestScoreResultMatchFoldsLatinAccents(t *testing.T) {
	if score := scoreResultMatch("tell me", "Tell më"); score <= 0 {
		t.Fatalf("expected accent-folded match, got score %d", score)
	}
}

func TestSearchAlternativesIncludeLatinToCyrillicScally(t *testing.T) {
	alternatives := searchAlternatives("scally milano")
	for _, alternative := range alternatives {
		if alternative == "скалли милано" {
			return
		}
	}
	t.Fatalf("expected scally milano alternatives to include скалли милано, got %#v", alternatives)
}

func TestScoreResultMatchHandlesLatinToCyrillic(t *testing.T) {
	if score := scoreResultMatch("scally milano", "Скалли Милано"); score <= 0 {
		t.Fatalf("expected latin query to match cyrillic value, got score %d", score)
	}
}

func TestRankResponsePromotesRelevantAlternativeResults(t *testing.T) {
	resp := Response{
		Tracks: []Track{
			{ID: 1, Title: "Random Hit", Artist: "Popular Artist", Popularity: 999, PlayCount: 999},
			{ID: 2, Title: "Скалли Милано", Artist: "Скалли Милано", Popularity: 1, PlayCount: 1},
		},
	}

	out := rankResponse(resp, "scally milano", 10)
	if len(out.Tracks) != 2 || out.Tracks[0].ID != 2 {
		t.Fatalf("expected relevant transliterated track first, got %#v", out.Tracks)
	}
}
