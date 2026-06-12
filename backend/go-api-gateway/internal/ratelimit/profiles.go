package ratelimit

import "time"

func ProfileByName(name string, isProduction bool) (LimitProfile, bool) {
	switch name {
	case "upload":
		return LimitProfile{Max: 20, Window: time.Minute}, true
	case "search":
		max := 600
		if isProduction {
			max = 120
		}
		return LimitProfile{Max: max, Window: time.Minute}, true
	case "social":
		max := 1200
		if isProduction {
			max = 300
		}
		return LimitProfile{Max: max, Window: time.Minute}, true
	case "artist_search":
		max := 300
		if isProduction {
			max = 60
		}
		return LimitProfile{Max: max, Window: time.Minute}, true
	case "artist_claims":
		max := 30
		if isProduction {
			max = 10
		}
		return LimitProfile{Max: max, Window: time.Minute}, true
	case "stream":
		max := 10000
		if isProduction {
			max = 2000
		}
		return LimitProfile{Max: max, Window: time.Minute, SkipOnDev: true}, true
	case "cover":
		max := 50000
		if isProduction {
			max = 5000
		}
		return LimitProfile{Max: max, Window: time.Minute, SkipOnDev: true}, true
	default:
		return LimitProfile{}, false
	}
}
