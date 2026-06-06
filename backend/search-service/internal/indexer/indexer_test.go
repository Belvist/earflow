package indexer

import (
	"strings"
	"testing"
)

func TestEnrichTrackDocBuildsSearchFields(t *testing.T) {
	genre := "Hip-Hop"
	year := 2024
	doc := trackDoc{
		ID:     1,
		Title:  "Tell m\u00EB",
		Artist: "\u041F\u043B\u0430\u0442\u0438\u043D\u0430",
		Album:  "2093 (P2)",
		Genre:  &genre,
		Year:   &year,
	}

	enrichTrackDoc(&doc)

	assertEqual(t, doc.TitleNorm, "tell me")
	assertEqual(t, doc.ArtistNorm, "\u043F\u043B\u0430\u0442\u0438\u043D\u0430")
	assertEqual(t, doc.ArtistTranslit, "platina")
	assertEqual(t, doc.AlbumNorm, "2093 p2")
	assertEqual(t, doc.GenreNorm, "hip hop")
	assertEqual(t, doc.YearText, "2024")

	for _, term := range []string{"tell me", "platina", "2093 p2", "hip hop", "2024"} {
		if !strings.Contains(doc.SearchText, term) {
			t.Fatalf("SearchText %q does not contain %q", doc.SearchText, term)
		}
	}
}

func TestEnrichArtistAndAlbumDocsBuildSearchFields(t *testing.T) {
	artistDoc := map[string]any{}
	enrichArtistDoc(artistDoc, "\u041F\u043B\u0430\u0442\u0438\u043D\u0430")

	assertEqual(t, artistDoc["artistNameNorm"], "\u043F\u043B\u0430\u0442\u0438\u043D\u0430")
	assertEqual(t, artistDoc["artistNameTranslit"], "platina")
	if !strings.Contains(StringValue(artistDoc["searchText"]), "platina") {
		t.Fatalf("artist searchText missing translit: %q", artistDoc["searchText"])
	}

	year := 2024
	albumDoc := map[string]any{}
	enrichAlbumDoc(albumDoc, "\u041F\u043B\u0430\u0442\u0438\u043D\u0430", "2093 (P2)", &year)

	assertEqual(t, albumDoc["artistNameTranslit"], "platina")
	assertEqual(t, albumDoc["albumNameNorm"], "2093 p2")
	assertEqual(t, albumDoc["yearText"], "2024")
	for _, term := range []string{"platina", "2093 p2", "2024"} {
		if !strings.Contains(StringValue(albumDoc["searchText"]), term) {
			t.Fatalf("album searchText %q does not contain %q", albumDoc["searchText"], term)
		}
	}
}

func assertEqual[T comparable](t *testing.T, got, want T) {
	t.Helper()
	if got != want {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func StringValue(v any) string {
	s, _ := v.(string)
	return s
}
