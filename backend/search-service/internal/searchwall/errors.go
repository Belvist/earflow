package searchwall

import "errors"

var (
	ErrBlocked   = errors.New("SEARCHWALL_BLOCKED")
	ErrThrottled = errors.New("SEARCHWALL_THROTTLED")
)
