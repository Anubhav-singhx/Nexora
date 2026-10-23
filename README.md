# OnboardIQ

Intelligent KYC onboarding for a savings account. A customer submits details and synthetic documents; a rules engine (R1 to R17) decides approve / review / reject with reasons; a KYC officer reviews uncertain cases; an independent compliance officer gives the final sign-off; a mock core-banking service opens the account; everything is audited.

Built for the Nexora / HCLTech BFSI hackathon (Case 02). **Use only synthetic data.**

> Status: complete for the Full Stack Web Engineer track (the AI-track deliverables are out of scope). **To check it against the case document, follow `VERIFY_AGAINST_CASE.md`.** `ASSUMPTIONS.md` lists what could not be confirmed without the HCL data pack.

## Prerequisites

- **Node.js 22** (20.19+ also works) and npm
- **PostgreSQL 16** running locally (a native install is fine; Docker is optional, see below)

## Quick start

```bash
npm run setup      # installs root + server + client packages and creates .env from .env.example
npm run seed       # creates all tables, the 3 demo users and the reference data (safe to repeat: it RESETS the data)
npm run dev        # API on http://localhost:3001 and web app on http://localhost:5173
```

Open <http://localhost:5173>. The sign-in page has one-click buttons for the demo accounts.

If your database or user does not exist yet, create them once (psql as the postgres user):

```sql
CREATE USER onboardiq WITH PASSWORD 'onboardiq' SUPERUSER;
CREATE DATABASE onboardiq OWNER onboardiq;
```

Docker users can run `npm run db:up` instead (see `docker-compose.yml`). Change `DATABASE_URL` in `.env` if your PostgreSQL uses other credentials.

### Demo logins

Password for all four: `Demo@1234` (`DEMO_PASSWORD` in `.env`).

| Role | Email | Lands on |
|---|---|---|
| Applicant | `applicant@demo.com` | My applications |
| KYC Officer (maker) | `officer@demo.com` | Review queue |
| Compliance Officer (checker) | `checker@demo.com` | Sign-off queue, dashboard, audit trail, rules and lists (can also work the review queue) |
| Second Compliance Officer | `checker2@demo.com` | Same; exists so that "maker and checker must differ" can be shown with two people |

The 12 worked examples of the case document are ready to use in `data/worked_examples/` (form values, files to upload and the expected result for each), and a timed 10-minute walkthrough is in `DEMO_SCRIPT.md`. The worked examples are dated 2026-03-04: set `APPLICATION_DATE=2026-03-04` in `.env` and restart `npm run dev` before running them in the browser, and empty it again afterwards.

## Scripts (run from the repository root)

| Script | What it does |
|---|---|
| `npm run setup` | Install everything and create `.env` |
| `npm run seed` | **Drop and recreate** all tables; load users, reference data and rule settings |
| `npm run dev` | API + web app together (`dev:server`, `dev:client` separately) |
| `npm run test:rules` | Pure rules-engine tests (no database needed) |
| `npm run test:sample` | The 60-case sample set through the engine and the batch writer (no database needed) |
| `npm run test:api` | All tests: engine, sample set, API, case replay (separate `onboardiq_test` database, 268 tests) |
| `npm run batch` | Evaluate the sample applications and write `output/decisions_output.csv`; reports `60/60 identical` against the expected columns |
| `npm run smoke` | End-to-end check against the **running** server (start it with `APPLICATION_DATE=2026-03-04`) |
| `npm run build` | Production build of the web app |

## What is where

```
code/server/src   Express API: routes/ controllers/ services/ (kyc engine, extraction, core banking, pipeline) db/ validators/
code/client/src   React + Vite: pages/ components/ context/ services/ lib/
data/             reference/ (watchlists, occupations, rule config), sample/ (60 batch cases + mock extraction), worked_examples/ (the case's 12 examples), tools/ (independent generator)
output/           decisions_output.csv (batch result)
output/design/    design_document, architecture, data model, status flow, R1 to R17 flowchart, security, OpenAPI (see output/design/README.md)
DEMO_SCRIPT.md    10-minute demo walkthrough
contract.md       API / status / error contract
ASSUMPTIONS.md   every assumption we made, and what to check against the HCL data pack
TESTING.md        how to run the tests and a browser walkthrough
VERIFY_AGAINST_CASE.md  every requirement of the case document mapped to a command or a click path
```

Ports: web 5173, API 3001, PostgreSQL 5432. The web app proxies `/api` to the API.

## Batch mode

`npm run batch` reads `data/sample/applications.csv`, `documents.csv`, `extraction_mock.csv` and the reference files in `data/reference/`, and writes `output/decisions_output.csv` (the six required columns, `|` between reason codes, four-decimal scores, empty risk and re-KYC for REJECT) using the same `evaluate()` function the live app uses. To run the HCL files when you have them:

```bash
npm run batch -- --applications path/applications.csv --documents path/documents.csv --extraction path/extraction_mock.csv --reference path/to/folder/with/the/case_02_files [--config path/case_02_rules_config_V1.0.json]
```

If the applications file has `expected_*` columns (the shipped sample does) the command compares every row and exits with an error on any difference.

## Switching extraction to a real service

`EXTRACTION_PROVIDER=mock` (default) reads `MOCK_EXTRACTION_FILE` (`data/sample/extraction_mock.csv`, long format `doc_id,field_name,value,confidence`) and looks documents up by id; an unknown id is `OTHER` with confidence 0.00. Set `EXTRACTION_PROVIDER=ai` plus `AI_EXTRACTION_URL` / `AI_EXTRACTION_API_KEY` to call an HTTP service with the same JSON shape; nothing else changes. A provider failure never rejects a customer: the document is treated as unreadable and the case goes to a human.

## Docker (optional, not tested in the build environment)

`docker compose up --build` starts PostgreSQL, the API (it seeds the tables on start) and the web app on <http://localhost:8080>. `docker compose up -d db` starts only the database for `npm run dev` on your own machine. The native PostgreSQL path above is the one that was tested.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot connect to PostgreSQL` | Start PostgreSQL; check `DATABASE_URL` in `.env` |
| Tables not found / old schema | `npm run seed` (the schema changed in Phase 2: re-run it after updating) |
| Port 3001 or 5173 busy | Close the other process; the web app refuses to pick another port on purpose |
| Login works but pages show "Cannot reach the server" | The API is not running: `npm run dev` |
| Windows says **"An Application Control policy has blocked this file"** | Windows Smart App Control is blocking an unsigned native file. This project avoids it on purpose: both `package.json` files pin Vite 7 / Vitest 3 and swap Rollup and esbuild for WebAssembly builds (`overrides`). Do not upgrade Vite or Vitest to the next major without testing on Windows |
| The worked examples give different results from the case document | They are dated 2026-03-04. Set `APPLICATION_DATE=2026-03-04` in `.env` and restart the API; leave it empty for normal use (then today's date in IST is used and a bill dated February 2026 is stale) |

## Team workflow

Branches: `feature/customer-backend` (Person 1), `feature/kyc-engine` (Person 2), `feature/compliance` (Person 3). Never commit `.env`, `node_modules`, `uploads/` contents or real personal data.
