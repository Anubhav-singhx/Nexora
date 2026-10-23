# VERIFY_AGAINST_CASE.md

How to prove that OnboardIQ does what `case_02_OnboardIQ_V1.0.docx` asks for. Track: **Full Stack Web Engineer** (the AI-track items are out of scope and are listed as such at the end).

Read in this order: section 1 (10 minutes, proves most of it), section 2 (the case's own "Done when" for every requirement), section 3 (the 12 worked examples), then sections 4 to 6.

## 1. The quick proof

Run these from the repository root. Everything is deterministic.

| Step | Command | You must see |
|---|---|---|
| 1 | `npm run seed` | four users, `Reference data loaded: 10 sanctions, 6 PEP, 5 existing customers, 12 occupations, 14 rule settings` |
| 2 | `npm run test:api` | `Test Files 10 passed`, `Tests 268 passed` (needs PostgreSQL; uses its own `onboardiq_test` database) |
| 3 | `npm run batch` | `Evaluated 60 applications ... Matches the expected_* columns of the applications file: 60/60 applications identical on all 5 output columns` and a new `output/decisions_output.csv` |
| 4 | `npm run build` | the web app builds |
| 5 | set `APPLICATION_DATE=2026-03-04` in `.env`, `npm run dev`, then in a second terminal `npm run smoke` | `All smoke checks passed` |
| 6 | the browser walkthrough in `TESTING.md` section 3 | each "Pass =" line |

Remember to empty `APPLICATION_DATE` again after steps 5 and 6.

**Honest limit.** Step 3 compares against expected results produced by *our own independent implementation* (`data/tools/generate_sample_data.py`, written separately from the Node engine and checked against the ten results printed in the case). The case says "all 60 sample applications match the expected columns" for HCL's files; that can only be proven with HCL's files. When you have them, see section 5.

## 2. Functional requirements (Section 5 of the case)

| ID | "Done when" (case) | How to see it | Automated proof |
|---|---|---|---|
| FR-1 | Applicant calling an officer API gets 403; changing the id in the URL does not expose another applicant's data or documents | Browser: as the applicant open `/review` (redirected). Copy an application URL, register another customer, paste it: an error, not the data | `case.test.js` "FR-1 access control"; `applications.test.js` (other applicant's application, document content, audit: 403); `compliance.test.js` "applicants cannot read another person's audit" |
| FR-2 | Invalid input gives 400 with field names; a 12-digit Aadhaar is refused; files stored outside the database with SHA-256; type, encoding, size checked | Browser: submit an empty form, a 12-digit Aadhaar, a `.pdf`, a 2 MB file. Files are in `uploads/` under random names; `documents.sha256` holds the hash | `case.test.js` "FR-2 validation"; `uploads.test.js` (18 tests: pdf, exe, image, double extension, NUL bytes, bad UTF-8, empty, over 1 MB = 413, exactly 1 MB accepted, more than 10, bad ids, duplicates); `applications.test.js` "detects a tampered stored file" |
| FR-3 | `POST /api/v1/documents/{doc_id}/extract` returns doc_type and fields with confidence in long format; mock looks up by doc_id; unknown = OTHER / 0.00; `EXTRACTION_PROVIDER` mock or ai; screen shows extracted values and confidence | Officer case page, *Documents* tab shows each field with its confidence bar. Provider switch: `EXTRACTION_PROVIDER` in `.env` | `pipeline.test.js` "extraction endpoint and provider switch (FR-3)" (unknown id = `OTHER` / 0.00, long-format `rows`, service-key call, `EXTRACTION_PROVIDER` switch, documented AI contract, provider failure never rejects) |
| FR-4 | Rules R1 to R17; decision, all reason codes, name_match_score, risk_category, rekyc_due_date; thresholds from configuration; changing `name_match_threshold` changes the decision; all 60 samples match | *Rules and lists*: change *Name similarity to pass* to 0.76 and apply example 4: approved instead of reviewed | `rules.test.js` (78 tests, every rule and boundary); `compliance.test.js` "FR-4: lowering name_match_threshold ..."; `sample.test.js` 60/60 |
| FR-5 | Example 4 shows 0.7647; examples 6 and 7 show the matched list entries SAN0002 and PEP0001; the screen shows the entry, similarity and dob comparison | Officer case page, *Rule verdict* panel and watchlist panels for examples 4, 6 (shown to compliance after rejection) and 7 | `sample.test.js` (0.7647); `rules.test.js` (SAN0002, PEP0001 hits with similarity and dob status) |
| FR-6 | Review queue by risk (HIGH first) then submission time; document text beside extracted fields with low confidence highlighted; correction with reason re-runs the rules; recommendation with comment; example 9 correction audited before/after | Browser step 5 of `TESTING.md` | `review.test.js` (20 tests); `case.test.js` example 12 |
| FR-7 | Maker-checker per the lifecycle; every REVIEW and every HIGH-risk APPROVE needs a checker; maker and checker differ (403, example 11); example 10 waits in PENDING_CHECKER; approval returns customer id and account number from the mock core-banking API | Browser step 6 of `TESTING.md` (two compliance accounts) | `case.test.js` examples 10 and 11; `compliance.test.js` (403 for the maker, 409 on stale version, two simultaneous decisions: exactly one wins, core banking down: 502 and nothing changes) |
| FR-8 | Status timeline, plain-language reasons, resubmission within 7 days; every reason code has a readable message; a resubmitted application is evaluated again | Browser step 7 of `TESTING.md` | `resubmission.test.js` (12 tests incl. the 7-day window and the expiry job); `case.test.js` "FR-8" (all 17 codes have a readable message with no score or list name); `pipeline.test.js` "what the applicant may see" |
| FR-9 | Append-only audit of status changes, decisions, corrections (before/after), watchlist hits and every document view (user, role, timestamp, doc_id); ordered history; no update or delete | *Audit trail* page; per-case history; `UPDATE audit_events SET event_type='X';` in psql fails | `compliance.test.js` "audit trail" (events in order, `DOCUMENT_VIEWED` with doc id, trigger blocks UPDATE and DELETE, CSV export); `case.test.js` |
| FR-10 | Dashboard: by status; straight-through = AUTO_APPROVED / all decided; review and reject rates; top 5 reason codes; average time in review; pending checker items; date filter; reconciles with the data | Compliance *Dashboard*; the "How these numbers are calculated" box | `compliance.test.js` "dashboard" (every number equals a direct SQL count, IST date filter, impossible ranges refused); `case.test.js` |
| FR-11 | Batch command reads applications, documents and extraction files and writes `/output/decisions_output.csv`; reproduces expected columns | `npm run batch` | `sample.test.js` (six columns in order, `\|` between codes, 4 decimals, empty cells for REJECT, JSONL input, duplicates and bad rows skipped, deterministic) |

## 3. The 12 worked examples (Section 9 of the case)

Each example has its form values, files and expected result in `data/worked_examples/exNN-*/README.md`. Sample applications `A2000001` to `A2000010` are examples 1 to 10 and are checked in `sample.test.js`; `case.test.js` replays all twelve through the HTTP API (submit the form and files as an applicant, read the decision, check the status, decision, codes, score, risk and re-KYC date, then the follow-up actions for 11 and 12).

| # | Scenario | Expected result | Status |
|---|---|---|---|
| 1 | Clean applicant | APPROVE, no codes, score 1.0000, LOW, re-KYC 2036-03-04 | AUTO_APPROVED, account opened |
| 2 | Under 18 | REJECT, `AGE_BELOW_18`, risk and re-KYC empty | AUTO_REJECTED |
| 3 | PAN mismatch | REJECT, `PAN_MISMATCH` | AUTO_REJECTED |
| 4 | Name differs slightly | REVIEW, `NAME_MISMATCH_MINOR`, score 0.7647, LOW | IN_REVIEW |
| 5 | Stale electricity bill | REVIEW, `ADDRESS_PROOF_STALE` | IN_REVIEW |
| 6 | Sanctions match | REJECT, `SANCTIONS_MATCH` (SAN0002) | AUTO_REJECTED |
| 7 | PEP match | REVIEW, `PEP_MATCH` (PEP0001), HIGH, re-KYC 2028-03-04 | IN_REVIEW |
| 8 | Wrong document type | REVIEW, `DOCUMENT_MISSING` and `DOCUMENT_TYPE_MISMATCH` | IN_REVIEW |
| 9 | Poor scan of the PAN card | REVIEW, `LOW_EXTRACTION_CONFIDENCE` | IN_REVIEW |
| 10 | High-risk occupation | APPROVE, HIGH, re-KYC 2028-03-04 | PENDING_CHECKER |
| 11 | Maker and checker must differ | Example 4: officer U1 recommends APPROVE; U1 deciding as checker gets HTTP 403; a different compliance officer U2 approves: APPROVED with customer id and account number | APPROVED |
| 12 | Officer corrects the PAN of example 9 | `pan_number` on D3000025 corrected to `ZZTPS9012Y` with a reason: APPROVE, no codes; PENDING_CHECKER; audit has old value `ZZTP59O12Y` and the new value | PENDING_CHECKER |

To do them by hand in the browser: set `APPLICATION_DATE=2026-03-04` (the examples are dated that day), restart the API, and follow `data/worked_examples/README.md`. Example 11 uses the two seeded compliance accounts `checker@demo.com` and `checker2@demo.com`.

## 4. Non-functional requirements and other outputs

| Requirement | Evidence |
|---|---|
| Rules evaluation of one application within 2 s with the mock provider | A submission runs extraction, rules and routing in well under a second (the pipeline tests wait for it); the batch evaluates 60 applications in about 0.1 s |
| 100-application batch within 60 s | `sample.test.js` evaluates 180 applications and asserts both the 60 s limit and under 5 s of engine time |
| Concurrency: second of two simultaneous actions gets 409 | `compliance.test.js` "two simultaneous decisions: exactly one wins"; `review.test.js` stale version 409 `VERSION_CONFLICT` |
| Precision: floating-point similarity rounded to 4 decimals only for output; IST calendar dates | `rules.test.js` (0.7647 from the unrounded value, thresholds compared unrounded); `compliance.test.js` IST date filter; `clock.js` |
| Configurability: thresholds, patterns, title tokens, re-KYC periods, watchlists are configuration or data; updating a watchlist re-screens open cases on request | *Rules and lists* page; `compliance.test.js` (config, watchlist create/update/delete, re-screen) |
| File handling: type, UTF-8, size, hash, never executed, non-guessable URLs needing authorisation | `uploads.test.js`; files stored as random `uuid.txt`; document content only through `GET /applications/:id/documents/:docId/content` with a token |
| Idempotency: same file hash for one application does not create a duplicate | `uploads.test.js` "duplicates" (409, nothing stored, and a database unique constraint) |
| Masking: Aadhaar last 4 only; PAN masked in lists, logs, exports | `compliance.test.js` (audit JSON and CSV contain no full PAN; masks look like `ZZTXXXXX2Y`); `review.test.js` and `compliance.test.js` queues (`pan_masked`) |
| Decision API response | `GET /api/v1/applications/{id}/decision`: `case.test.js` checks application_id, decision, reason_codes, name_match_score, risk_category, rekyc_due_date, status and per-document doc_type and confidence |
| `/output/decisions_output.csv` | `output/decisions_output.csv` (60 rows, regenerated by `npm run batch`) |
| Audit export CSV with document views and field corrections | `GET /api/v1/applications/{id}/audit/export`, *Export CSV* button on the audit page |

## 5. Deliverables (Section 11 of the case)

| Deliverable | Where |
|---|---|
| Design document: R1 to R17 flowchart and routing, extraction-service interface, API documentation, technology decisions, assumptions | `output/design/design_document.md` (links to `rules.md` with the flowchart, `openapi.yaml`, `architecture.md`, `security.md`, `ASSUMPTIONS.md`) |
| Status-lifecycle diagram and ER diagram | `output/design/state-machine.md`, `output/design/er-diagram.md` (Mermaid) |
| Rule configuration loaded from `case_02_rules_config_V1.0.json`; watchlists from the sanctions and PEP files | `data/reference/` (our stand-ins). Drop the HCL files in with their own names and run `npm run seed`; the loader recognises the `case_02_*` file names and many key spellings and prints anything it could not map |
| `/output/decisions_output.csv` | `output/decisions_output.csv` |
| `/code`: source, seed scripts, mock extraction and core-banking services, tests, Dockerfile, docker-compose.yml | `code/server`, `code/client`, `code/server/src/db/seed.js`, `code/server/src/services/extraction/mockProvider.js`, `code/server/src/services/coreBanking/`, `code/server/tests`, `code/server/Dockerfile`, `code/client/Dockerfile`, `docker-compose.yml` |

**When the HCL data pack arrives**

1. Copy their reference files into `data/reference/` (keep their names), then `npm run seed`. Read the console line that lists which settings were understood.
2. Run `npm run batch -- --applications <their applications file> --documents <their documents file> --extraction <their extraction_mock file> --reference data/reference` (add `--expected <file>` if the expected columns are in a separate file). It prints every difference against the expected columns, or `60/60`.
3. If a column name or file layout differs, the places to adjust are listed in `ASSUMPTIONS.md` (table "Must verify").

## 6. Out of scope and known limits

- **Out of scope per the case, not built:** real UIDAI / NSDL / CKYC / DigiLocker checks, face match or liveness, real sanctions or PEP feeds, e-sign and funding, mobile app, real SMS or e-mail. **AI-track deliverables** (`extraction_output.csv`, `ai_decisions_output.csv`, model card, evaluation report) belong to the other track and are not included; the provider switch for them (`EXTRACTION_PROVIDER=ai`) is.
- **Bonus ideas:** the watchlist-update re-screen of open cases is built; image upload, text-span highlighting, mock CKYC search, re-KYC reminder job and transliterated matching are not.
- **Not verified here:** `docker compose up --build` (the build environment had no Docker daemon; the compose file only passes a syntax check). The native PostgreSQL route is the tested one.
- **Assumptions that depend on the data pack** are in `ASSUMPTIONS.md`: file layouts, the key names inside `case_02_rules_config_V1.0.json`, and the sample set being our own.
