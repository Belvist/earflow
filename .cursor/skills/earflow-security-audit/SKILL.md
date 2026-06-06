---
name: earflow-security-audit
description: Security review checklist for Earflow changes — auth, CSRF, SQL injection, XSS, secrets, upload validation, nginx headers. Use before merging auth/gateway/upload/nginx changes or when the user asks for a security audit.
---

# Earflow Security Audit

Reference: `reports/SECURITY.md`, `reports/comprehensive-security-plan.md`

## Pre-merge checklist

### Auth & session
- [ ] Protected endpoints verify session/JWT server-side
- [ ] No tokens in localStorage or URL query params
- [ ] Cookie flags: Secure, HttpOnly where applicable, SameSite per env
- [ ] Refresh rotation / logout invalidates session in Redis auth

### Gateway
- [ ] CSRF on all `class: unsafe` mutating routes
- [ ] Rate limits present; not widened without reason
- [ ] Spoofed headers stripped before upstream
- [ ] Service-to-service uses `X-Service-Token`, not user cookies

### Input & data
- [ ] SQL parameterized (no string concat)
- [ ] User HTML escaped on render (React default; no `dangerouslySetInnerHTML` without sanitize)
- [ ] File uploads: size, type, extension checks
- [ ] Path traversal blocked on static/media paths

### Secrets & config
- [ ] No secrets in diff (.env, keys, passwords)
- [ ] New env vars documented in `.env.example` (names only, no values)
- [ ] Logs do not print tokens, passwords, PII

### Edge (nginx)
- [ ] CSP, HSTS, X-Frame-Options maintained
- [ ] CORS limited to earflow domains
- [ ] TLS 1.2+ only in prod configs

## Severity output format

- **Critical** — must fix before merge (auth bypass, secret leak, SQLi)
- **High** — fix soon (missing CSRF, IDOR)
- **Medium** — harden when possible
- **Low** — informational

## Scan scripts

```bash
node scripts/security-scan.js
node scripts/service-audit.js
```
