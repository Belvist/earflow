-- auth-core register race: dedupe on normalized email hash (sha256 of lowercase email).
-- CreateUser maps a 23505 unique-violation to EMAIL_TAKEN, so the unique index
-- closes the two-parallel-registrations race for one email.
-- PostgreSQL UNIQUE indexes allow multiple NULL email_hash rows (legacy users);
-- prod audit found no duplicates (see docs/PENDING.md PEND-AUTH-005).
CREATE UNIQUE INDEX IF NOT EXISTS users_email_hash_unique ON users (email_hash);
