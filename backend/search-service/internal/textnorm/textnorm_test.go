package textnorm

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestNormalizeQuery(t *testing.T) {
	got := NormalizeQuery("  \u0401\u0436\u0438\u043A   \u0432   \u0442\u0443\u043C\u0430\u043D\u0435  ")
	want := "\u0435\u0436\u0438\u043A \u0432 \u0442\u0443\u043C\u0430\u043D\u0435"
	if got != want {
		t.Fatalf("NormalizeQuery() = %q, want %q", got, want)
	}
}

func TestNormalizeQueryFoldsLatinAccents(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{in: "Tell m\u00EB", want: "tell me"},
		{in: "Lif\u00EBstyl\u00EB", want: "lifestyle"},
		{in: "Caf\u00E9 D\u00E9j\u00E0 Vu", want: "cafe deja vu"},
		{in: "\u0439\u043E\u0433\u0430", want: "\u0439\u043E\u0433\u0430"},
	}

	for _, tt := range tests {
		if got := NormalizeQuery(tt.in); got != tt.want {
			t.Fatalf("NormalizeQuery(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestNormalizeQueryTruncatesByRunes(t *testing.T) {
	raw := strings.Repeat("\u0434", 121)
	got := NormalizeQuery(raw)
	if utf8.RuneCountInString(got) != 120 {
		t.Fatalf("got %d runes, want 120", utf8.RuneCountInString(got))
	}
	if !utf8.ValidString(got) {
		t.Fatalf("normalized query is not valid utf-8")
	}
}

func TestSwapKeyboardLayout(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "en to ru", in: "ghbdtn", want: "\u043F\u0440\u0438\u0432\u0435\u0442"},
		{name: "ru to en", in: "\u043F\u0440\u0438\u0432\u0435\u0442", want: "ghbdtn"},
		{name: "yo key", in: "`", want: "\u0451"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := SwapKeyboardLayout(tt.in); got != tt.want {
				t.Fatalf("SwapKeyboardLayout(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestTransliterateCyrillic(t *testing.T) {
	got := TransliterateCyrillic("\u041F\u043B\u0430\u0442\u0438\u043D\u0430")
	want := "platina"
	if got != want {
		t.Fatalf("TransliterateCyrillic() = %q, want %q", got, want)
	}
}

func TestTransliterateCyrillicReturnsEmptyWhenUnchanged(t *testing.T) {
	if got := TransliterateCyrillic("yeat"); got != "" {
		t.Fatalf("TransliterateCyrillic() = %q, want empty", got)
	}
}

func TestTransliterateLatin(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{in: "platina", want: "\u043F\u043B\u0430\u0442\u0438\u043D\u0430"},
		{in: "skally milano", want: "\u0441\u043A\u0430\u043B\u043B\u0438 \u043C\u0438\u043B\u0430\u043D\u043E"},
		{in: "scally milano", want: "\u0441\u043A\u0430\u043B\u043B\u0438 \u043C\u0438\u043B\u0430\u043D\u043E"},
		{in: "zhara", want: "\u0436\u0430\u0440\u0430"},
	}

	for _, tt := range tests {
		if got := TransliterateLatin(tt.in); got != tt.want {
			t.Fatalf("TransliterateLatin(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}
