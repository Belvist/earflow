package domain

import (
	"strings"
	"unicode"
)

type PasswordRules struct {
	MinLength       int  `json:"minLength"`
	MaxLength       int  `json:"maxLength"`
	RequireLetter   bool `json:"requireLetter"`
	RequireDigit    bool `json:"requireDigit"`
}

type PasswordCheck struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	OK    bool   `json:"ok"`
}

type PasswordStrength struct {
	Rules           PasswordRules    `json:"rules"`
	Score           int              `json:"score"`
	MaxScore        int              `json:"maxScore"`
	Label           string           `json:"label"`
	Tone            string           `json:"tone"`
	MeetsComplexity bool             `json:"meetsComplexity"`
	Checks          []PasswordCheck  `json:"checks"`
	Hints           PasswordHints    `json:"hints"`
}

type PasswordHints struct {
	ImproveLength  bool `json:"improveLength"`
	ImproveMix     bool `json:"improveMix"`
	ImproveSpecial bool `json:"improveSpecial"`
}

type passwordChecksInternal struct {
	HasLower   bool
	HasUpper   bool
	HasLetter  bool
	HasDigit   bool
	HasSpecial bool
	LengthOK   bool
	Length     int
}

func evaluateChecks(password string, rules PasswordRules) passwordChecksInternal {
	var pc passwordChecksInternal
	pc.Length = len(password)
	pc.LengthOK = pc.Length >= rules.MinLength && pc.Length <= rules.MaxLength

	for _, r := range password {
		switch {
		case unicode.IsLower(r):
			pc.HasLower = true
			pc.HasLetter = true
		case unicode.IsUpper(r):
			pc.HasUpper = true
			pc.HasLetter = true
		case unicode.IsDigit(r):
			pc.HasDigit = true
		case isSpecial(r):
			pc.HasSpecial = true
		}
	}
	return pc
}

func isSpecial(r rune) bool {
	if r == ' ' {
		return true
	}
	if unicode.IsLetter(r) || unicode.IsDigit(r) {
		return false
	}
	return unicode.IsPrint(r) || unicode.IsPunct(r) || unicode.IsSymbol(r)
}

// EvaluatePasswordStrength is the single source of truth for password policy.
// The frontend calls /password/strength which returns this struct so the UI
// renders hints without duplicating rules.
func EvaluatePasswordStrength(password string, rules PasswordRules) PasswordStrength {
	pc := evaluateChecks(password, rules)

	complex := pc.LengthOK &&
		(!rules.RequireLetter || pc.HasLetter) &&
		(!rules.RequireDigit || pc.HasDigit)

	score := 0
	if pc.Length >= rules.MinLength {
		score++
	}
	if pc.Length >= 12 {
		score++
	}
	if pc.HasLower && pc.HasUpper {
		score++
	}
	if pc.HasDigit {
		score++
	}
	if pc.HasSpecial {
		score++
	}

	label := "Пусто"
	tone := "neutral"
	switch {
	case pc.Length == 0:
		label, tone = "Пусто", "neutral"
	case score <= 2:
		label, tone = "Слабый", "danger"
	case score == 3:
		label, tone = "Средний", "warn"
	case score == 4:
		label, tone = "Хороший", "ok"
	default:
		label, tone = "Отличный", "ok"
	}

	minLabel := strings.ReplaceAll("Не менее {N} символов", "{N}", itoaMin(rules.MinLength))

	return PasswordStrength{
		Rules:           rules,
		Score:           score,
		MaxScore:        5,
		Label:           label,
		Tone:            tone,
		MeetsComplexity: complex,
		Checks: []PasswordCheck{
			{ID: "length", Label: minLabel, OK: pc.LengthOK},
			{ID: "letters", Label: "Содержит буквы", OK: pc.HasLetter},
			{ID: "digits", Label: "Содержит цифры", OK: pc.HasDigit},
		},
		Hints: PasswordHints{
			ImproveLength:  pc.Length < 12,
			ImproveMix:     !(pc.HasLower && pc.HasUpper) || !pc.HasDigit,
			ImproveSpecial: !pc.HasSpecial,
		},
	}
}

func itoaMin(n int) string {
	if n <= 0 {
		return "8"
	}
	s := ""
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	return s
}
