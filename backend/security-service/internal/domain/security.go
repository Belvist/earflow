package domain

import (
	"fmt"
	"sort"
	"time"
)

// Level describes the computed security posture of the account.
type Level struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Tone     string `json:"tone"`
	Score    int    `json:"score"`
	MaxScore int    `json:"maxScore"`
}

type Issue struct {
	ID       string `json:"id"`
	Severity string `json:"severity"`
	Title    string `json:"title"`
	Message  string `json:"message"`
}

type StatTile struct {
	ID    string `json:"id"`
	Icon  string `json:"icon"`
	Label string `json:"label"`
	Value string `json:"value"`
	Sub   string `json:"sub,omitempty"`
	Tone  string `json:"tone"`
}

type BlockReason struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type PasswordCapability struct {
	CanChange              bool         `json:"canChange"`
	CanSet                 bool         `json:"canSet"`
	Mode                   string       `json:"mode"`
	RequiresCurrentPassword bool        `json:"requiresCurrentPassword"`
	RequiresStepUp         bool         `json:"requiresStepUp"`
	BlockReason            *BlockReason `json:"blockReason,omitempty"`
}

type TelegramCapability struct {
	CanUnlink      bool         `json:"canUnlink"`
	RequiresStepUp bool         `json:"requiresStepUp"`
	BlockReason    *BlockReason `json:"blockReason,omitempty"`
}

type SessionsCapability struct {
	CanRevokeOthers bool         `json:"canRevokeOthers"`
	OtherCount      int          `json:"otherCount"`
	RequiresStepUp  bool         `json:"requiresStepUp"`
	BlockReason     *BlockReason `json:"blockReason,omitempty"`
}

type MfaCapability struct {
	CanDisable                    bool `json:"canDisable"`
	CanRegenerateRecovery         bool `json:"canRegenerateRecovery"`
	CanSetup                      bool `json:"canSetup"`
	RequiresStepUpForSensitive    bool `json:"requiresStepUpForSensitive"`
}

type SecurityContext struct {
	MFAEnabled              bool
	MFAEnabledAt            string
	HasPassword             bool
	HasTelegram             bool
	RecoveryCodesRemaining  int
	StepUpActive            bool
}

// ComputeLevel returns the computed security posture level.
func ComputeLevel(ctx SecurityContext) Level {
	score := 0
	if ctx.MFAEnabled {
		score += 2
	}
	if ctx.HasPassword {
		score++
	}
	if ctx.RecoveryCodesRemaining > 0 {
		score++
	}
	if ctx.StepUpActive {
		score++
	}

	const maxScore = 5
	switch {
	case score >= 4:
		return Level{ID: "high", Label: "Высокая", Tone: "ok", Score: score, MaxScore: maxScore}
	case score >= 2:
		return Level{ID: "medium", Label: "Средняя", Tone: "warn", Score: score, MaxScore: maxScore}
	default:
		return Level{ID: "low", Label: "Низкая", Tone: "danger", Score: score, MaxScore: maxScore}
	}
}

// ComputeIssues returns issues sorted by severity then insertion order.
func ComputeIssues(ctx SecurityContext) []Issue {
	issues := make([]Issue, 0, 4)

	if !ctx.MFAEnabled {
		issues = append(issues, Issue{
			ID:       "no_mfa",
			Severity: "critical",
			Title:    "Включите 2FA",
			Message:  "Аккаунт уязвим к взлому по паролю",
		})
	}
	if !ctx.HasPassword && ctx.HasTelegram {
		issues = append(issues, Issue{
			ID:       "no_password",
			Severity: "high",
			Title:    "Установите пароль",
			Message:  "Позволяет входить без Telegram и восстанавливать доступ",
		})
	}
	if !ctx.HasPassword && !ctx.HasTelegram {
		issues = append(issues, Issue{
			ID:       "no_login_methods",
			Severity: "critical",
			Title:    "Нет методов входа",
			Message:  "Ни пароль, ни Telegram не настроены",
		})
	}
	if ctx.MFAEnabled && ctx.RecoveryCodesRemaining <= 0 {
		issues = append(issues, Issue{
			ID:       "no_recovery",
			Severity: "high",
			Title:    "Нет recovery-кодов",
			Message:  "Сгенерируйте новые коды на случай потери устройства",
		})
	} else if ctx.MFAEnabled && ctx.RecoveryCodesRemaining <= 3 {
		issues = append(issues, Issue{
			ID:       "low_recovery",
			Severity: "medium",
			Title:    "Осталось мало recovery-кодов",
			Message:  fmt.Sprintf("Осталось %d из 10", ctx.RecoveryCodesRemaining),
		})
	}

	sort.SliceStable(issues, func(i, j int) bool {
		return severityWeight(issues[i].Severity) < severityWeight(issues[j].Severity)
	})
	return issues
}

func severityWeight(s string) int {
	switch s {
	case "critical":
		return 0
	case "high":
		return 1
	case "medium":
		return 2
	default:
		return 3
	}
}

// ComputeStats returns tiles rendered by the frontend.
func ComputeStats(ctx SecurityContext, sessionsCount int) []StatTile {
	stats := make([]StatTile, 0, 4)

	mfaSub := "Требуется включить"
	mfaTone := "warn"
	if ctx.MFAEnabled {
		mfaTone = "ok"
		switch {
		case ctx.StepUpActive:
			mfaSub = "Step-up активен"
		case ctx.MFAEnabledAt != "":
			if label := FormatDateShortRu(ctx.MFAEnabledAt); label != "" {
				mfaSub = "С " + label
			} else {
				mfaSub = "Активна"
			}
		default:
			mfaSub = "Активна"
		}
	}
	mfaValue := "—"
	if ctx.MFAEnabled {
		mfaValue = "2FA"
	}
	stats = append(stats, StatTile{
		ID:    "mfa",
		Icon:  "shield",
		Label: "Двухфакторная",
		Value: mfaValue,
		Sub:   mfaSub,
		Tone:  mfaTone,
	})

	pwdValue := "—"
	pwdSub := "Только Telegram-вход"
	pwdTone := "warn"
	if ctx.HasPassword {
		pwdValue = "Задан"
		pwdSub = "Вход по email/паролю"
		pwdTone = "ok"
	}
	stats = append(stats, StatTile{
		ID:    "password",
		Icon:  "lock",
		Label: "Пароль",
		Value: pwdValue,
		Sub:   pwdSub,
		Tone:  pwdTone,
	})

	recValue := "—"
	recSub := "2FA выключена"
	recTone := "neutral"
	if ctx.MFAEnabled {
		recValue = fmt.Sprintf("%d", ctx.RecoveryCodesRemaining)
		switch {
		case ctx.RecoveryCodesRemaining <= 0:
			recSub = "Сгенерируйте новые"
			recTone = "danger"
		case ctx.RecoveryCodesRemaining <= 3:
			recSub = "Осталось мало кодов"
			recTone = "warn"
		default:
			recSub = "Хранятся одноразовыми"
			recTone = "ok"
		}
	}
	stats = append(stats, StatTile{
		ID:    "recovery",
		Icon:  "key",
		Label: "Recovery-коды",
		Value: recValue,
		Sub:   recSub,
		Tone:  recTone,
	})

	sessSub := "Нет активных"
	sessTone := "neutral"
	switch {
	case sessionsCount == 1:
		sessSub = "Только текущая сессия"
		sessTone = "ok"
	case sessionsCount >= 5:
		sessSub = "Проверьте чужие устройства"
		sessTone = "warn"
	case sessionsCount > 1:
		sessSub = "Можно завершить чужие"
		sessTone = "ok"
	}
	sessValue := "—"
	if sessionsCount >= 0 {
		sessValue = fmt.Sprintf("%d", sessionsCount)
	}
	stats = append(stats, StatTile{
		ID:    "sessions",
		Icon:  "desktop",
		Label: "Активные устройства",
		Value: sessValue,
		Sub:   sessSub,
		Tone:  sessTone,
	})

	return stats
}

// ComputePasswordCapability returns UI capability flags for the password card.
func ComputePasswordCapability(ctx SecurityContext) PasswordCapability {
	if ctx.HasPassword {
		return PasswordCapability{
			CanChange:               true,
			CanSet:                  false,
			Mode:                    "change",
			RequiresCurrentPassword: true,
			RequiresStepUp:          ctx.MFAEnabled,
		}
	}
	if !ctx.MFAEnabled {
		return PasswordCapability{
			CanChange:      false,
			CanSet:         false,
			Mode:           "set",
			RequiresStepUp: true,
			BlockReason: &BlockReason{
				Code:    "MFA_REQUIRED_TO_SET_PASSWORD",
				Message: "Сначала включите 2FA — установка пароля доступна только после",
			},
		}
	}
	return PasswordCapability{
		CanChange:      false,
		CanSet:         true,
		Mode:           "set",
		RequiresStepUp: true,
	}
}

// ComputeTelegramCapability returns UI capability flags for the telegram card.
func ComputeTelegramCapability(ctx SecurityContext) TelegramCapability {
	if !ctx.HasTelegram {
		return TelegramCapability{
			BlockReason: &BlockReason{
				Code:    "TELEGRAM_NOT_LINKED",
				Message: "Telegram не привязан",
			},
		}
	}
	if !ctx.HasPassword {
		return TelegramCapability{
			BlockReason: &BlockReason{
				Code:    "PASSWORD_REQUIRED_BEFORE_UNLINK",
				Message: "Сначала установите пароль — иначе потеряете доступ",
			},
		}
	}
	return TelegramCapability{
		CanUnlink:      true,
		RequiresStepUp: ctx.MFAEnabled,
	}
}

// ComputeSessionsCapability returns UI capability flags for the sessions card.
func ComputeSessionsCapability(ctx SecurityContext, otherCount int) SessionsCapability {
	if otherCount <= 0 {
		return SessionsCapability{
			OtherCount:     otherCount,
			RequiresStepUp: ctx.MFAEnabled,
			BlockReason: &BlockReason{
				Code:    "NO_OTHER_SESSIONS",
				Message: "Других сессий нет",
			},
		}
	}
	return SessionsCapability{
		CanRevokeOthers: true,
		OtherCount:      otherCount,
		RequiresStepUp:  ctx.MFAEnabled,
	}
}

// ComputeMfaCapability returns UI capability flags for the MFA card.
func ComputeMfaCapability(ctx SecurityContext) MfaCapability {
	return MfaCapability{
		CanDisable:                 ctx.MFAEnabled,
		CanRegenerateRecovery:      ctx.MFAEnabled,
		CanSetup:                   !ctx.MFAEnabled,
		RequiresStepUpForSensitive: ctx.MFAEnabled,
	}
}

// SessionView is the client-facing decorated session record.
type SessionView struct {
	SID              string `json:"sid"`
	Current          bool   `json:"current"`
	CreatedAt        string `json:"createdAt,omitempty"`
	LastSeenAt       string `json:"lastSeenAt,omitempty"`
	ExpiresInSeconds int64  `json:"expiresInSeconds,omitempty"`
	IP               string `json:"ip"`
	Device           string `json:"device"`
	DeviceType       string `json:"deviceType"`
	CreatedAtLabel   string `json:"createdAtLabel"`
	LastSeenLabel    string `json:"lastSeenLabel"`
	ExpiresLabel     string `json:"expiresLabel"`
}

// DecorateSession turns raw session info into a client-ready view.
func DecorateSession(sid string, jti string, ttlSeconds int64, createdAt, lastSeenAt, ip, ua, currentSID string, now time.Time) SessionView {
	return SessionView{
		SID:              sid,
		Current:          sid == currentSID,
		CreatedAt:        createdAt,
		LastSeenAt:       lastSeenAt,
		ExpiresInSeconds: ttlSeconds,
		IP:               MaskIP(ip),
		Device:           ShortUaLabel(ua),
		DeviceType:       DetectDeviceType(ua),
		CreatedAtLabel:   ifNonEmpty(FormatDateTimeShortRu(createdAt), ""),
		LastSeenLabel:    ifNonEmpty(FormatRelativeRu(lastSeenAt, now), "давно"),
		ExpiresLabel:     FormatExpiresRu(ttlSeconds),
	}
}

func ifNonEmpty(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}

// SortSessions orders sessions with current first, then by lastSeenAt desc.
func SortSessions(in []SessionView) {
	sort.SliceStable(in, func(i, j int) bool {
		if in[i].Current && !in[j].Current {
			return true
		}
		if !in[i].Current && in[j].Current {
			return false
		}
		ti := parseRFC3339(in[i].LastSeenAt)
		tj := parseRFC3339(in[j].LastSeenAt)
		return ti.After(tj)
	})
}

func parseRFC3339(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}
	}
	return t
}
