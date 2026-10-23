# Security and privacy

| Area | What is done |
|---|---|
| Passwords | bcrypt hashes; the same 401 and the same response time for an unknown email and a wrong password |
| Sign-in abuse | 8 failed attempts for one email from one address block further attempts for 15 minutes (429 `TOO_MANY_ATTEMPTS`, `Retry-After`); a successful sign-in clears the count; every failure is audited |
| Sessions | JWT HS256, 8 h; the role is read from the database on every request, so the token cannot grant a role |
| Access control | Role guard on every route group; object-level check on every application and document (applicant sees only their own: 403); server enforces everything the UI hides |
| Maker-checker | A compliance officer cannot decide a case they recommended (403); stale edits are rejected (409) |
| Input | zod validation on every body; strict PAN / Aadhaar / pincode / mobile formats; JSON limit 100 KB |
| Aadhaar | Only the last 4 digits are accepted; a 12-digit value is refused and never stored |
| PAN | Masked (`ZZKXXXXX4Q`: first three letters, `X`, last two) in queues, audit responses and CSV exports; full value only inside a case for the people who must compare it |
| Uploads | `.txt` only, UTF-8, 1 byte to 1 MB, 3 to 10 files; content checked (binary, empty, wrong encoding refused); stored under random names, never the user's file name; path traversal in ids refused; SHA-256 stored and re-verified on every read (tampering is detected) |
| Audit | Append-only table protected by a trigger; actor, role, time, old and new values for every state change, correction, decision, configuration or watchlist change, document view and export |
| Customer privacy | Applicants never see scores, confidences, watchlist hits, list names or other customers' data; a rejection shows one generic sentence |
| Transport / headers | `helmet` defaults, CORS limited to configured origins, `x-powered-by` removed. Use HTTPS in any real deployment |
| Secrets | `.env` is not committed; the server refuses a `change_me` JWT secret in production |
| Core banking | Mock service requires `x-api-key`; the key lives only on the server |

## Known limits (accepted for a synthetic-data demo)

- JWTs live in `localStorage`; a production system would use httpOnly cookies and CSRF protection.
- The sign-in limiter is per server process (in memory).
- Uploaded files are stored on local disk without encryption at rest.
- No malware scanning (files are plain text and are never executed or rendered as HTML).
