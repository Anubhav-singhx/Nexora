# Architecture

OnboardIQ is a three-tier web application: a React single-page app, a Node/Express API, and PostgreSQL. All business rules live in one pure module that the live app, the tests and the batch command share.

```mermaid
flowchart LR
  subgraph Browser
    SPA["React 19 + Vite SPA<br/>applicant / officer / compliance screens"]
  end
  subgraph API["Express 5 API  (port 3001)"]
    MW["helmet, CORS, JWT auth,<br/>role guard, login limiter"]
    CTRL["Controllers<br/>application, review, compliance, audit"]
    PIPE["Pipeline<br/>extract, evaluate, route"]
    STATE["applicationState.transition()<br/>the ONLY writer of status"]
    ENG["services/kyc  (pure engine)<br/>evaluate(app, docs, refs, config)"]
    EXT["Extraction provider<br/>mock CSV | AI service"]
    CORE["Core banking client<br/>in-process mock | HTTP"]
    JOBS["Background job<br/>expiry every 5 min"]
  end
  DB[("PostgreSQL 16<br/>applications, documents, extracted_fields,<br/>reference data, rule_config, audit_events")]
  FS[("uploads/<br/>random uuid.txt files")]
  BATCH["npm run batch<br/>CSV / JSONL in, decisions_output.csv out"]

  SPA -- "/api/v1 (JWT)" --> MW --> CTRL
  CTRL --> PIPE --> EXT
  PIPE --> ENG
  PIPE --> STATE --> DB
  CTRL --> STATE
  CTRL --> CORE
  CTRL --> FS
  ENG -. "reads reference data + config" .-> DB
  JOBS --> STATE
  BATCH --> ENG
```

## One engine, three callers

`evaluate()` takes plain objects and returns a decision. It never touches the database, the clock or randomness (the application date is an input). That is why the same function serves:

1. the live submission pipeline,
2. re-evaluation after every officer correction, re-screening and resubmission,
3. `npm run batch` for files, and the unit tests.

## Submission pipeline

```mermaid
sequenceDiagram
  participant C as Customer (SPA)
  participant A as API
  participant X as Extraction provider
  participant E as Rules engine
  participant S as State service
  participant D as PostgreSQL
  C->>A: POST /applications (form + .txt files)
  A->>A: validate, hash (SHA-256), store files, one transaction
  A->>D: application SUBMITTED, documents, audit
  A-->>C: 201 (tracker opens)
  A->>S: SUBMITTED to EXTRACTING
  loop each document
    A->>X: extract(doc_id, text)
    X-->>A: type, confidence, fields
    A->>D: save fields + audit DOCUMENT_EXTRACTED
  end
  A->>E: evaluate(...)
  E-->>A: decision, reason codes, risk, trace
  A->>S: route to AUTO_APPROVED / IN_REVIEW / PENDING_CHECKER / AUTO_REJECTED
  S->>D: status, version+1, STATUS_CHANGED + EVALUATED audit
  opt AUTO_APPROVED
    A->>A: open mock core-banking account
  end
```

If the extraction provider fails, the document is treated as unreadable and the case goes to a human; the customer is never rejected because a service was down.

## Maker-checker

```mermaid
flowchart TD
  R[Rules say REVIEW] --> Q[KYC officer queue]
  Q -->|correct fields| RE[Rules re-run, still IN_REVIEW]
  RE --> Q
  Q -->|recommend approve / reject| P[Compliance sign-off queue]
  Q -->|ask for documents| W[Customer has 7 days]
  W -->|uploads| Q
  W -->|no reply| X[CLOSED_EXPIRED]
  H[Rules say APPROVE but HIGH risk] --> P
  P -->|approve| A[APPROVED + account opened]
  P -->|reject| J[REJECTED]
  P -->|send back| Q
```

Separation of duties is enforced in the API, not only in the UI: the compliance officer who is recorded as the maker of a case gets 403 on its decision.

## Concurrency and consistency

- Every status change goes through `transition()`: row lock (`SELECT ... FOR UPDATE`), lifecycle check, version check, version bump, audit row, all in one transaction.
- Officer and checker calls carry the `version` they read. A stale version returns 409 `VERSION_CONFLICT`. Tested with two truly simultaneous requests: exactly one succeeds.
- Account opening happens before the checker's status change is committed. If core banking fails, nothing changes (502) and the decision can be retried. Automatic approvals keep their approval and the account can be retried by the compliance officer; creation is idempotent.

## Configuration and reference data

Thresholds (`rule_config`), sanctions and PEP lists, occupations and existing customers are database tables loaded from `data/reference/`. A compliance officer edits thresholds and watchlists in the UI; the next evaluation uses them, and every change is audited with old and new values.

## Technology choices

| Choice | Reason |
|---|---|
| Express 5, plain SQL (`pg`) | Small surface, transactions and row locks are explicit and reviewable |
| zod validators | One schema per request body; same messages reach the form |
| JWT (HS256, 8 h) with role re-read from the database | A demoted user loses access at once |
| PostgreSQL trigger on `audit_events` | Append-only is enforced by the database, not by convention |
| Vite 7 / Vitest 3 with WebAssembly Rollup and esbuild | Runs on locked-down Windows machines that block unsigned native binaries |
| Dockerfiles + `docker-compose.yml` (api, web, db) | One-command run for reviewers; the native-PostgreSQL path stays supported |
