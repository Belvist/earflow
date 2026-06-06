package ranking

import "testing"

func TestRankCandidatesFiltersInvalidIDsAndHonorsLimit(t *testing.T) {
	out, err := RankCandidates(Request{
		Limit: 2,
		Candidates: []Candidate{
			{ID: 1, Artist: "alpha", Popularity: 100, SourceScore: 0.1},
			{ID: 2, Artist: "beta", Popularity: 20, SourceScore: 1.0},
			{ID: -1, Artist: "noise", Popularity: 100, SourceScore: 10.0},
		},
	})
	if err != nil {
		t.Fatalf("RankCandidates returned error: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("ranked length = %d, want 2", len(out))
	}
	if out[0].ID != 2 || out[1].ID != 1 {
		t.Fatalf("rank order = %+v, want ids [2 1]", out)
	}
}

func TestRankCandidatesCapsLimitAtHundred(t *testing.T) {
	candidates := make([]Candidate, 120)
	for i := range candidates {
		candidates[i] = Candidate{ID: i + 1, SourceScore: float64(i)}
	}

	out, err := RankCandidates(Request{Limit: 1000, Candidates: candidates})
	if err != nil {
		t.Fatalf("RankCandidates returned error: %v", err)
	}
	if len(out) != 100 {
		t.Fatalf("ranked length = %d, want 100", len(out))
	}
}
