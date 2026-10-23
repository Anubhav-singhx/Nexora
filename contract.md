# contract.md - the shared agreement (final)

Everything the three modules code against. Change something only by agreement, and edit this file in the same pull request as the code. All three modules are implemented; this file describes what the code does today.

Prefix for every API path: `/api/v1`. Authentication: `Authorization: Bearer <JWT>` on everything except `/health`, `/auth/register`, `/auth/login`, and `/mock-core-banking/*` (which uses its own `x-api-key`).

## 1. Roles

| Role string | Who | Can do |
|---|---|---|
| `APPLICANT` | Customer | Create applications, resubmit, read own applications and documents (safe view only) |
| `KYC_OFFICER` | Maker | Review queue, read any application (full view), correct extracted fields, recommend |
| `COMPLIANCE_OFFICER` | Checker | Final decision, dashboard, rule configuration, watchlists, re-screening, audit search and export |

Registration always creates `APPLICANT`. Officers exist only through the seed script. The role is read from the database on every request.

## 2. Exact strings

- **Status:** `SUBMITTED`, `EXTRACTING`, `AUTO_APPROVED`, `IN_REVIEW`, `PENDING_CHECKER`, `AUTO_REJECTED`, `RESUBMISSION_REQUESTED`, `APPROVED`, `REJECTED`, `CLOSED_EXPIRED`
- **Decision (engine):** `APPROVE`, `REVIEW`, `REJECT`. **Risk:** `LOW`, `MEDIUM`, `HIGH` (null when `REJECT`)
- **Maker recommendation:** `APPROVE`, `REJECT`, `REQUEST_RESUBMISSION`. **Checker decision:** `APPROVE`, `REJECT`, `SEND_BACK`
- **Document type:** `PAN_CARD`, `AADHAAR_CARD`, `ELECTRICITY_BILL`, `BANK_STATEMENT`, `DRIVING_LICENCE` (address proofs: the last three). The extractor may also return `OTHER` (unknown document, confidence 0.00).
- **Extracted fields:** `name`, `dob`, `gender`, `pan_number`, `aadhaar_last4`, `address`, `pincode`, `document_date`, `valid_until`
- **Dates** `YYYY-MM-DD` (IST calendar dates for the rules). **Timestamps** ISO 8601. **Scores** 4 decimals, rounded only for output.
- Constants live in `code/server/src/constants.js`.

## 3. Status transitions

```
SUBMITTED -> EXTRACTING -> AUTO_APPROVED | IN_REVIEW | PENDING_CHECKER | AUTO_REJECTED
IN_REVIEW -> PENDING_CHECKER | RESUBMISSION_REQUESTED
RESUBMISSION_REQUESTED -> SUBMITTED | CLOSED_EXPIRED
PENDING_CHECKER -> APPROVED | REJECTED | IN_REVIEW
AUTO_APPROVED, AUTO_REJECTED, APPROVED, REJECTED, CLOSED_EXPIRED: terminal
```

Engine decision to status (`routeStatus`): `REJECT` -> `AUTO_REJECTED`; `REVIEW` -> `IN_REVIEW`; `APPROVE` -> `AUTO_APPROVED`, except HIGH risk or a case a human already touched (officer correction, resubmission) -> `PENDING_CHECKER`. **Only `services/applicationState.js` changes a status**: it locks the row, checks the lifecycle table (409 `INVALID_TRANSITION`), checks the optimistic `version` (409 `VERSION_CONFLICT`), bumps the version and writes the `STATUS_CHANGED` audit row.

## 4. Errors

Every error body: `{ "error": { "code", "message", "details": [ { "field", "message" } ] } }` (`details` optional).

| HTTP | code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_JSON` | Field problems / body is not JSON |
| 400 | `TOO_FEW_DOCUMENTS`, `TOO_MANY_DOCUMENTS`, `UNSUPPORTED_FILE_TYPE`, `INVALID_DOCUMENT` | Upload rules (3 to 10 `.txt` files, UTF-8, 1 byte to 1 MB) |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` | No/invalid token; wrong email or password (same message) |
| 429 | `TOO_MANY_ATTEMPTS` | 8 failed sign-ins for one email from one address; blocked 15 minutes, `Retry-After` header |
| 403 | `FORBIDDEN` | Wrong role, someone else's application, checker is the maker of the case |
| 404 | `NOT_FOUND` | Unknown id or route |
| 409 | `EMAIL_TAKEN`, `DUPLICATE_DOCUMENT`, `DUPLICATE_DOCUMENT_ID` | Duplicates |
| 409 | `VERSION_CONFLICT` | Someone else changed the application first; reload and retry |
| 409 | `INVALID_STATE`, `INVALID_TRANSITION` | Action not allowed in the current status |
| 409 | `RESUBMISSION_WINDOW_EXPIRED` | The 7 days have passed |
| 413 | `FILE_TOO_LARGE` | File over 1 MB |
| 502 | `CORE_BANKING_UNAVAILABLE`, `EXTRACTION_PROVIDER_ERROR` | Downstream service failed; nothing was changed |

An applicant asking for someone else's application gets **403**; an id that does not exist gets **404**.

## 5. Customer APIs

| Method + path | Role | What |
|---|---|---|
| `GET /health` | public | `{status, db, time}` |
| `POST /auth/register`, `POST /auth/login`, `GET /auth/me` | public / any | `{token, user}` |
| `POST /applications` | APPLICANT | multipart (below) -> 201 `{application}`; the verification pipeline runs right after |
| `GET /applications` | APPLICANT | own applications (safe view) |
| `GET /applications/:id` | owner or staff | applicant: safe view + `timeline`; staff: full record, extracted fields per document, rule trace in `evaluation` |
| `POST /applications/:id/resubmit` | APPLICANT | multipart, 1 to 10 files. Only in `RESUBMISSION_REQUESTED` before the deadline. Replaces documents by type (address proofs replace each other), keeps old versions, resets the application date to today, re-runs the pipeline (an approval then needs the checker) |
| `GET /applications/:id/documents` | owner or staff | metadata |
| `GET /applications/:id/documents/:docId/content` | owner or staff | text; writes `DOCUMENT_VIEWED` |
| `GET /applications/:id/decision` | owner or staff | staff: `{decision: {application_id, decision, reason_codes, name_match_score, risk_category, rekyc_due_date, status, documents[{doc_id, declared_doc_type, doc_type, confidence}]}}`; owner: status and plain reasons only |
| `POST /documents/:docId/extract` | signed-in user, or the backend with header `x-service-key` | provider look-up (`EXTRACTION_PROVIDER=mock\|ai`). Returns `{doc_id, provider, doc_type, confidence, fields[{field_name, value, confidence}], rows[...long format...]}`; unknown `doc_id` gives `doc_type OTHER`, confidence 0 |
| `GET /reference/occupations` | any | `[{code, name}]` (no risk levels) |

`POST /applications` fields: `full_name`, `dob`, `gender` (`MALE`/`FEMALE`/`OTHER`), `pan_number`, `aadhaar_last4` (exactly 4 digits; a 12-digit value is refused), `mobile`, `email`, `address`, `city`, `state`, `pincode`, `occupation_code` (from `GET /reference/occupations`), `annual_income`, `consent=true`, repeated `documents` + `document_types` (+ optional `doc_ids`, default = file name without `.txt`). Older names `pan` and `occupation` are still accepted. **`doc_id` is the key the mock extractor uses.** The application date is today in IST, or `APPLICATION_DATE` when that variable is set (used to reproduce the worked examples dated 2026-03-04).

The applicant view never contains risk, scores, confidence, reason codes, maker/checker data or watchlist details; rejected applications get a generic message only.

## 6. Engine (`services/kyc/`, pure)

`evaluate(application, documents, refs, config)` returns `{ decision, reason_codes[], name_match_score, risk_category, risk_basis, rekyc_due_date, rules[17], name_scores, selected_documents, watchlist, engine_version }`. No database, clock or randomness inside (the application date is an input). The same function serves the live app, the tests and `npm run batch`.

Rule order R1 to R17 (`reason_codes` are returned in this order): R1 `DOCUMENT_MISSING`, R2 `DOCUMENT_TYPE_MISMATCH`, R3 `LOW_EXTRACTION_CONFIDENCE`, R4 `AGE_BELOW_18`, R5 `PAN_INVALID`, R6 `PAN_MISMATCH`, R7 `DOB_MISMATCH`, R8 `AADHAAR_MISMATCH`, R9 `NAME_MISMATCH`, R10 `SANCTIONS_MATCH`, R11 `NAME_MISMATCH_MINOR`, R12 `DOCUMENT_EXPIRED`, R13 `ADDRESS_PROOF_STALE`, R14 `ADDRESS_MISMATCH`, R15 `SANCTIONS_POSSIBLE_MATCH`, R16 `PEP_MATCH`, R17 `DUPLICATE_CUSTOMER`. `REJECT` beats `REVIEW` beats `APPROVE`. Thresholds come from `rule_config` (editable by the compliance officer, no restart); key names are listed in `output/design/rules.md`.

## 7. Officer APIs (KYC_OFFICER)

| Method + path | What |
|---|---|
| `GET /review/queue?status=IN_REVIEW\|RESUBMISSION_REQUESTED` | HIGH risk first, then oldest submission; PAN masked |
| `PATCH /review/:id/documents/:docId/fields/:field` | body `{value, reason, version}`; stores the correction (confidence 1.00, source `OFFICER`, original kept), audits old to new, re-runs every rule, status stays `IN_REVIEW`. Field `document_type` (alias `doc_type`) corrects the classification |
| `POST /review/:id/recommend` | body `{recommendation, comment (>= 10 chars), version}` -> `PENDING_CHECKER` or `RESUBMISSION_REQUESTED` (7-day deadline) |

## 8. Compliance APIs (COMPLIANCE_OFFICER)

| Method + path | What |
|---|---|
| `GET /compliance/pending` | cases in `PENDING_CHECKER`, HIGH first, with the officer's comment; each row has `hours_waiting` and `sla_overdue` (checker SLA 24 h) |
| `POST /compliance/:id/decision` | body `{decision, comment, version}`. 403 if the checker is the maker. `APPROVE` opens the mock core-banking account first; on failure 502 and nothing changes |
| `POST /compliance/:id/open-account` | idempotent retry for an approved application without an account |
| `GET /compliance/dashboard?from&to` | counts, rates, review time, top reasons, per-day series, `definitions` explaining every number |
| `GET` / `PATCH /compliance/config` | rule thresholds; `PATCH { changes: { key: value } }`, validated, versioned, audited |
| `GET/POST/PATCH/DELETE /compliance/watchlists` | sanctions and PEP entries; every change audited |
| `POST /compliance/rescreen` | re-runs open cases against the current lists; a new watchlist hit sends a waiting case back to `IN_REVIEW` |
| `GET /compliance/audit?application_id&event_type&actor_role&from&to` | search the audit trail |
| `GET /applications/:id/audit` (staff), `/audit/export` (compliance, CSV) | per-application trail; PAN masked |
| `* /mock-core-banking/*` | mock service, `x-api-key` protected; ids are deterministic (`CUST%08d`, `5010%08d`) |

## 9. Audit event types

`USER_REGISTERED`, `LOGIN_SUCCESS`, `LOGIN_FAILED`, `APPLICATION_CREATED`, `DOCUMENT_UPLOADED`, `DOCUMENT_VIEWED`, `DOCUMENT_EXTRACTED`, `DOCUMENT_REPLACED`, `EVALUATED`, `STATUS_CHANGED`, `FIELD_CORRECTED`, `MAKER_RECOMMENDED`, `CHECKER_DECIDED`, `RESUBMITTED`, `APPLICATION_EXPIRED`, `CORE_ACCOUNT_CREATED`, `CORE_ACCOUNT_FAILED`, `CONFIG_UPDATED`, `WATCHLIST_UPDATED`, `RESCREEN_RUN`, `AUDIT_EXPORTED`. Rows are append-only (a database trigger rejects UPDATE and DELETE).

## 10. Storage

Uploads: `uploads/<random uuid>.txt` (never the user's file name), SHA-256 stored and re-checked on every read. PAN is stored raw and masked (`ZZKXXXXX4Q`: first three letters, `X`s, last two) in lists, audit responses and exports. Aadhaar: only the last 4 digits are ever accepted or stored.

## 11. Related documents

`output/design/design_document.md` (entry point), `output/design/openapi.yaml` (machine-readable version of this contract), `output/design/state-machine.md`, `output/design/rules.md`, `ASSUMPTIONS.md` and `VERIFY_AGAINST_CASE.md`.
