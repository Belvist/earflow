package ranking

type Candidate struct {
	ID            int      `json:"id"`
	Artist        string   `json:"artist"`
	Tempo         *float64 `json:"tempo"`
	Energy        *float64 `json:"energy"`
	Popularity    float64  `json:"popularity"`
	PlayCount     float64  `json:"playCount"`
	UserPlayCount int      `json:"userPlayCount"`
	UserSkipCount int      `json:"userSkipCount"`
	SourceScore   float64  `json:"sourceScore"`
}

type Context struct {
	IsEvening bool     `json:"isEvening"`
	SeedTempo *float64 `json:"seedTempo"`
}

type Request struct {
	Limit      int         `json:"limit"`
	Context    Context     `json:"context"`
	Candidates []Candidate `json:"candidates"`
}

type Ranked struct {
	ID    int     `json:"id"`
	Score float64 `json:"score"`
}

type Response struct {
	Ranked []Ranked `json:"ranked"`
}

func RankCandidates(req Request) ([]Ranked, error) {
	limit := req.Limit
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}

	in := req.Candidates
	if len(in) == 0 {
		return []Ranked{}, nil
	}

	scored := make([]scoredCandidate, 0, len(in))
	for _, c := range in {
		if c.ID <= 0 {
			continue
		}
		scored = append(scored, scoredCandidate{cand: c, score: baseScore(c, req.Context)})
	}

	if len(scored) == 0 {
		return []Ranked{}, nil
	}
	if limit > len(scored) {
		limit = len(scored)
	}

	selected := make([]Ranked, 0, limit)
	artistCounts := map[string]int{}

	currentTempo := req.Context.SeedTempo

	for len(selected) < limit {
		bestIdx := 0
		bestScore := -1e18

		for i := range scored {
			c := scored[i]

			adj := c.score
			if a := c.cand.Artist; a != "" {
				cnt := artistCounts[a]
				if cnt > 0 {
					adj *= 1.0 / (1.0 + float64(cnt)*0.8)
				}
			}

			if currentTempo != nil && c.cand.Tempo != nil {
				d := abs(*c.cand.Tempo - *currentTempo)
				adj -= 0.15 * clamp01(d/50.0)
			}

			if adj > bestScore {
				bestScore = adj
				bestIdx = i
			}
		}

		picked := scored[bestIdx]
		copy(scored[bestIdx:], scored[bestIdx+1:])
		scored = scored[:len(scored)-1]

		selected = append(selected, Ranked{ID: picked.cand.ID, Score: bestScore})
		if picked.cand.Artist != "" {
			artistCounts[picked.cand.Artist]++
		}
		if picked.cand.Tempo != nil {
			currentTempo = picked.cand.Tempo
		}
		if len(scored) == 0 {
			break
		}
	}

	return selected, nil
}

type scoredCandidate struct {
	cand  Candidate
	score float64
}

func baseScore(c Candidate, ctx Context) float64 {
	pop := clamp01(c.Popularity / 100.0)
	plays := clamp01(c.PlayCount / 5000.0)
	s := c.SourceScore + 0.35*pop + 0.10*plays

	den := float64(c.UserPlayCount + c.UserSkipCount + 1)
	skipRate := float64(c.UserSkipCount) / den
	s -= 0.60 * skipRate

	if ctx.IsEvening && c.Energy != nil {
		if *c.Energy > 0.65 {
			s -= 0.10 * clamp01((*c.Energy-0.65)/0.35)
		}
	}

	if ctx.SeedTempo != nil && c.Tempo != nil {
		d := abs(*c.Tempo - *ctx.SeedTempo)
		s -= 0.20 * clamp01(d/60.0)
	}

	return s
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func abs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}
