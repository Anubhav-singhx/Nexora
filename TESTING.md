# TESTING.md - run the tests and click through the app

For the requirement-by-requirement check against the case document, use **`VERIFY_AGAINST_CASE.md`**. This file covers setup, the automated tests and a browser walkthrough. Run everything from the repository root.

## 0. One-time setup

```bash
npm run setup && npm run seed
```

`npm run seed` must print four users and `Reference data loaded: 10 sanctions, 6 PEP, 5 existing customers, 12 occupations, 14 rule settings`. It can be repeated: it resets the data. **Re-run it after every update** (the schema changed with the case alignment).

## 1. Automated tests

| Command | Pass looks like | Covers |
|---|---|---|
| `npm run test:rules` | `Tests 78 passed` | Every rule R1 to R17 and its boundaries (age exactly 18, 90 days, 0.75 / 0.90), name normalisation, watchlist MATCH vs POSSIBLE, document selection, usable fields, risk and re-KYC (incl. 29 Feb), the configuration loader |
| `npm run test:sample` | `Tests 10 passed` | The 60-application sample set against its expected columns (all five output columns), the ten worked examples, all 17 reason codes occur, the six-column CSV, 180 applications in well under 60 s |
| `npm run test:api` | `Test Files 10 passed`, `Tests 268 passed` | Everything above plus `case.test.js` (worked examples 1 to 12 through the HTTP API, FR-1, FR-2, FR-7, FR-9, FR-10), auth, validation, uploads, pipeline, officer corrections, checker decisions, resubmission and expiry, dashboard, watchlists and re-screening, audit append-only, sign-in lock |
| `npm run batch` | `Matches the expected_* columns of the applications file: 60/60 applications identical on all 5 output columns` | Writes `output/decisions_output.csv` |

The API tests use their own `onboardiq_test` database (created and wiped automatically) and set `APPLICATION_DATE=2026-03-04`; your development data is safe.

## 2. Smoke test against the running app

Put `APPLICATION_DATE=2026-03-04` in `.env`, start `npm run dev` in one terminal, then run `npm run smoke` in another. Pass = every line has a tick and the last line says `All smoke checks passed` (about 30 checks over real HTTP and real multipart uploads, using worked example 1). Empty `APPLICATION_DATE` again afterwards.

## 3. Walkthrough in the browser (about 20 minutes)

Keep `APPLICATION_DATE=2026-03-04` set. Open <http://localhost:5173> and use the demo buttons on the sign-in page. For each example, the form values and files are in `data/worked_examples/exNN-*/README.md`; select all three files at once in the upload box (the type of each file is suggested from its content; check it).

1. **Example 1, clean approval.** Applicant: apply. Pass = a green **Approved** stamp and an account number (`5010...`) within a few seconds.
2. **Validation.** Press *Submit application* with an empty form: field errors appear. A 12-digit Aadhaar and PAN `ABCDE12345` are refused.
3. **Example 6, sanctions.** Pass = red **Rejected**, and the page says nothing about sanctions (customers only ever see a generic message).
4. **Example 10, high-risk occupation.** Pass = **Final sign-off** (rules approved it, but a jeweller is high risk, so a person must sign). Sign in as Compliance, open it from *Sign-off queue*, approve. Pass = **Approved** and an account number.
5. **Example 9 then 12, officer correction.** Apply with example 9 (poor scan): **In review**. Officer: open it, open document `D3000025`, press *Fix* on PAN number, type `ZZTPS9012Y`, give a reason, save. Pass = the toast says the decision changed from REVIEW to APPROVE; the case shows **Final sign-off**; *Audit trail* shows the old value and the new value.
6. **Example 4 then 11, maker and checker.** Apply with example 4 (score 0.7647, in review). Sign in as Compliance (`checker@demo.com`), open *Review queue*, recommend approval with a comment. Open the case from *Sign-off queue* and try to decide: refused. Sign in as *Compliance 2* and approve: **Approved** with an account number.
7. **Resubmission.** Apply with example 4 again; officer chooses *Ask for new documents*. Applicant: the tracker shows **Needs documents** and a 7-day countdown; upload `data/worked_examples/ex04-.../resubmission/D9000001.txt` and `D9000002.txt`. Pass = the case returns to review or sign-off; the old documents appear as "replaced".
8. **Example 7, PEP.** Pass = **PEP match** and **High risk** in the officer queue, listed first.
9. **Dashboard.** Compliance: *Dashboard* shows totals, straight-through, review and reject rates, top reasons, average review time and a per-day chart; "How these numbers are calculated" explains each figure.
10. **Audit.** *Audit trail* lists every action; filter by application id; open a case and press *Export CSV*. PANs are masked (`ZZKXXXXX4Q`).
11. **Rules and lists.** Change *Reject below name similarity* to 0.80, save, apply example 4 again: it is now auto-rejected. Restore 0.75. Add a sanctions entry and press *Re-screen*: open cases that now match move back to review.
12. **Access control.** Signed in as the applicant, open `/review`: you are sent back to *My applications*. Copy an application URL, sign out, register another customer and paste it: you get an error, not the data.

## 4. Look inside the database

```sql
SELECT id, status, decision, reason_codes, risk_category, name_match_score, rekyc_due_date FROM applications ORDER BY id DESC LIMIT 5;
SELECT event_type, role, application_id, created_at FROM audit_events ORDER BY id DESC LIMIT 15;
UPDATE audit_events SET event_type = 'X';   -- must fail: "audit_events is append-only"
```

## If something fails

| Symptom | Likely cause |
|---|---|
| `ECONNREFUSED` in tests or seed | PostgreSQL is not running |
| `column ... does not exist` | Old schema: run `npm run seed` |
| Tests say the database name must end in `_test` | `TEST_DATABASE_URL` in `.env` was edited; restore it from `.env.example` |
| Smoke prints "Could not reach the server" | `npm run dev` is not running |
| Smoke or an example gives REVIEW instead of APPROVE | `APPLICATION_DATE=2026-03-04` is not set in `.env` (restart the API after changing it) |
| Application stays "Verifying" | Look at the API terminal for an error; the pipeline retries stuck applications on the next start |
| "Application Control policy has blocked this file" | See the README troubleshooting table |
