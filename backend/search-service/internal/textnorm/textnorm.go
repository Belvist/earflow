package textnorm

import (
	"strings"
	"unicode"
)

var latinAccentReplacer = strings.NewReplacer(
	"\u00E0", "a", "\u00E1", "a", "\u00E2", "a", "\u00E3", "a", "\u00E4", "a", "\u00E5", "a", "\u0101", "a",
	"\u00E7", "c", "\u010D", "c",
	"\u00E8", "e", "\u00E9", "e", "\u00EA", "e", "\u00EB", "e", "\u0113", "e",
	"\u00EC", "i", "\u00ED", "i", "\u00EE", "i", "\u00EF", "i", "\u012B", "i",
	"\u00F1", "n",
	"\u00F2", "o", "\u00F3", "o", "\u00F4", "o", "\u00F5", "o", "\u00F6", "o", "\u00F8", "o", "\u014D", "o",
	"\u00F9", "u", "\u00FA", "u", "\u00FB", "u", "\u00FC", "u", "\u016B", "u",
	"\u00FD", "y", "\u00FF", "y",
	"\u00E6", "ae", "\u0153", "oe", "\u00DF", "ss",
)

func NormalizeQuery(raw string) string {
	s := strings.TrimSpace(raw)
	s = strings.ToValidUTF8(s, "")
	s = strings.ToLower(s)
	s = strings.ReplaceAll(s, "\u0451", "\u0435")
	s = latinAccentReplacer.Replace(s)
	s = strings.Join(strings.Fields(s), " ")
	runes := []rune(s)
	if len(runes) > 120 {
		s = string(runes[:120])
	}
	return s
}

var ruToEn = map[rune]rune{
	'\u0439': 'q', '\u0446': 'w', '\u0443': 'e', '\u043A': 'r', '\u0435': 't',
	'\u043D': 'y', '\u0433': 'u', '\u0448': 'i', '\u0449': 'o', '\u0437': 'p',
	'\u0445': '[', '\u044A': ']',
	'\u0444': 'a', '\u044B': 's', '\u0432': 'd', '\u0430': 'f', '\u043F': 'g',
	'\u0440': 'h', '\u043E': 'j', '\u043B': 'k', '\u0434': 'l',
	'\u0436': ';', '\u044D': '\'',
	'\u0451': '`', '\u044F': 'z', '\u0447': 'x', '\u0441': 'c', '\u043C': 'v',
	'\u0438': 'b', '\u0442': 'n', '\u044C': 'm',
	'\u0431': ',', '\u044E': '.',
}

var enToRu = func() map[rune]rune {
	m := map[rune]rune{}
	for k, v := range ruToEn {
		m[v] = k
	}
	return m
}()

var cyrToLatin = map[rune]string{
	'\u0430': "a",
	'\u0431': "b",
	'\u0432': "v",
	'\u0433': "g",
	'\u0434': "d",
	'\u0435': "e",
	'\u0436': "zh",
	'\u0437': "z",
	'\u0438': "i",
	'\u0439': "y",
	'\u043A': "k",
	'\u043B': "l",
	'\u043C': "m",
	'\u043D': "n",
	'\u043E': "o",
	'\u043F': "p",
	'\u0440': "r",
	'\u0441': "s",
	'\u0442': "t",
	'\u0443': "u",
	'\u0444': "f",
	'\u0445': "h",
	'\u0446': "ts",
	'\u0447': "ch",
	'\u0448': "sh",
	'\u0449': "sch",
	'\u044A': "",
	'\u044B': "y",
	'\u044C': "",
	'\u044D': "e",
	'\u044E': "yu",
	'\u044F': "ya",
}

var latinToCyr = map[string]string{
	"shch": "\u0449",
	"sch":  "\u0449",
	"yo":   "\u0435",
	"yu":   "\u044E",
	"ya":   "\u044F",
	"zh":   "\u0436",
	"ch":   "\u0447",
	"sh":   "\u0448",
	"ts":   "\u0446",
	"ph":   "\u0444",
	"ck":   "\u043A",
	"a":    "\u0430",
	"b":    "\u0431",
	"c":    "\u043A",
	"v":    "\u0432",
	"g":    "\u0433",
	"d":    "\u0434",
	"e":    "\u0435",
	"z":    "\u0437",
	"i":    "\u0438",
	"j":    "\u0439",
	"y":    "\u0438",
	"k":    "\u043A",
	"l":    "\u043B",
	"m":    "\u043C",
	"n":    "\u043D",
	"o":    "\u043E",
	"p":    "\u043F",
	"q":    "\u043A",
	"r":    "\u0440",
	"s":    "\u0441",
	"t":    "\u0442",
	"u":    "\u0443",
	"f":    "\u0444",
	"w":    "\u0432",
	"x":    "\u043A\u0441",
	"h":    "\u0445",
}

func TransliterateCyrillic(raw string) string {
	q := NormalizeQuery(raw)
	if q == "" {
		return ""
	}

	changed := false
	var b strings.Builder
	for _, r := range []rune(q) {
		if repl, ok := cyrToLatin[r]; ok {
			b.WriteString(repl)
			changed = true
			continue
		}
		b.WriteRune(r)
	}
	if !changed {
		return ""
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

func TransliterateLatin(raw string) string {
	q := NormalizeQuery(raw)
	if q == "" {
		return ""
	}

	changed := false
	parts := strings.Fields(q)
	outParts := make([]string, 0, len(parts))
	for _, part := range parts {
		var b strings.Builder
		for i := 0; i < len(part); {
			matched := false
			for _, width := range []int{4, 3, 2, 1} {
				if i+width > len(part) {
					continue
				}
				chunk := part[i : i+width]
				if repl, ok := latinToCyr[chunk]; ok {
					b.WriteString(repl)
					changed = true
					i += width
					matched = true
					break
				}
			}
			if matched {
				continue
			}
			b.WriteByte(part[i])
			i++
		}
		outParts = append(outParts, b.String())
	}
	if !changed {
		return ""
	}
	return strings.Join(outParts, " ")
}

func SwapKeyboardLayout(q string) string {
	if q == "" {
		return ""
	}

	changed := false
	out := make([]rune, 0, len(q))
	for _, r := range []rune(q) {
		if r2, ok := ruToEn[r]; ok {
			out = append(out, r2)
			changed = true
			continue
		}
		if r2, ok := enToRu[r]; ok {
			out = append(out, r2)
			changed = true
			continue
		}
		out = append(out, r)
	}
	if !changed {
		return ""
	}
	return string(out)
}

func SimplifySeparators(q string) string {
	if q == "" {
		return ""
	}

	var b strings.Builder
	lastSpace := true
	for _, r := range []rune(q) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			lastSpace = false
			continue
		}
		if unicode.IsSpace(r) || strings.ContainsRune("-_./\\'\"`’‘:,;()[]{}+&", r) {
			if !lastSpace {
				b.WriteByte(' ')
				lastSpace = true
			}
		}
	}

	return strings.Join(strings.Fields(b.String()), " ")
}
