package searchwall

import "time"

type Config struct {
	MaxQueryRunes          int
	MaxUniquePerWindow     int
	Window                 time.Duration
	MaxWindowEntries       int
	EntryTTL               time.Duration
	AllowEmptyQuery        bool
	RequireSingleValueKeys bool
}

func DefaultConfig() Config {
	return Config{
		MaxQueryRunes:          120,
		MaxUniquePerWindow:     15,
		Window:                 2 * time.Second,
		MaxWindowEntries:       48,
		EntryTTL:               3 * time.Minute,
		AllowEmptyQuery:        true,
		RequireSingleValueKeys: false,
	}
}
