package party

func KeyDoc(partyID string) string { return "mp:party:v2:" + partyID + ":doc" }

func KeyInvite(partyID, code string) string { return "mp:party:v2:" + partyID + ":invite:" + code }

// KeyInviteByCode is global code → partyId (TTL = invite TTL)
func KeyInviteByCode(code string) string { return "mp:party:v2:invitecode:" + code }

// KeyUserHosted lists party ids where user is host (SET)
func KeyUserHosted(userID string) string { return "mp:party:v2:user:" + userID + ":hosted" }
