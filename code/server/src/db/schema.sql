-- OnboardIQ database schema (PostgreSQL 16).
-- Re-runnable: running this file DROPS and recreates every table (that is what `npm run seed` does).
-- Owner: Person 1. Need a new column? Ask Person 1, they add it here, push to main, everyone re-runs `npm run seed`.

DROP TABLE IF EXISTS
  audit_events, rule_config, occupations, existing_customers, pep_entries, sanctions_entries,
  extracted_fields, documents, applications, users
CASCADE;
DROP SEQUENCE IF EXISTS application_seq;
DROP FUNCTION IF EXISTS audit_events_immutable();

-- ---------------------------------------------------------------- users
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  name          TEXT        NOT NULL,
  email         TEXT        NOT NULL UNIQUE,            -- always stored lower-case
  password_hash TEXT        NOT NULL,
  role          TEXT        NOT NULL CHECK (role IN ('APPLICANT', 'KYC_OFFICER', 'COMPLIANCE_OFFICER')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- applications
-- Ids look like A3000001 (the HCL sample ids start at A2000001, ours start higher so they never clash).
-- Column names follow the case data dictionary except two kept short: pan = pan_number, occupation = occupation_code
-- (the API accepts and returns the case names).
CREATE SEQUENCE application_seq START 3000001;

CREATE TABLE applications (
  id                     TEXT PRIMARY KEY DEFAULT ('A' || nextval('application_seq')),
  user_id                INTEGER     NOT NULL REFERENCES users (id),

  -- declared by the customer
  full_name              TEXT        NOT NULL,
  dob                    DATE        NOT NULL,
  gender                 TEXT        NOT NULL DEFAULT 'UNSPECIFIED',
  pan                    TEXT        NOT NULL CHECK (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  aadhaar_last4          TEXT        NOT NULL CHECK (aadhaar_last4 ~ '^[0-9]{4}$'),
  email                  TEXT        NOT NULL DEFAULT '',
  address                TEXT        NOT NULL,
  city                   TEXT        NOT NULL DEFAULT '',
  state                  TEXT        NOT NULL DEFAULT '',
  pincode                TEXT        NOT NULL CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  mobile                 TEXT        NOT NULL CHECK (mobile ~ '^[6-9][0-9]{9}$'),
  occupation             TEXT        NOT NULL,                 -- occupation_code (see the occupations table)
  annual_income          NUMERIC(14, 2) NOT NULL CHECK (annual_income >= 0),
  consent                BOOLEAN     NOT NULL CHECK (consent = TRUE),
  consent_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- workflow state (see TRANSITIONS in src/constants.js)
  status                 TEXT        NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN (
                           'SUBMITTED', 'EXTRACTING', 'AUTO_APPROVED', 'IN_REVIEW', 'PENDING_CHECKER',
                           'AUTO_REJECTED', 'RESUBMISSION_REQUESTED', 'APPROVED', 'REJECTED', 'CLOSED_EXPIRED')),

  -- latest engine output (Person 2 supplies the values, Person 1 persists them)
  decision               TEXT        CHECK (decision IN ('APPROVE', 'REVIEW', 'REJECT')),
  reason_codes           TEXT[]      NOT NULL DEFAULT '{}',
  name_match_score       NUMERIC(6, 4),
  risk_category          TEXT        CHECK (risk_category IN ('LOW', 'MEDIUM', 'HIGH')),
  rekyc_due_date         DATE,
  evaluation             JSONB,                          -- full engine output / match evidence for officers

  -- maker-checker (Person 3)
  maker_id               INTEGER     REFERENCES users (id),
  maker_recommendation   TEXT        CHECK (maker_recommendation IN ('APPROVE', 'REJECT', 'REQUEST_RESUBMISSION')),
  maker_comment          TEXT,
  maker_at               TIMESTAMPTZ,
  checker_id             INTEGER     REFERENCES users (id),
  checker_decision       TEXT        CHECK (checker_decision IN ('APPROVE', 'REJECT', 'SEND_BACK')),
  checker_comment        TEXT,
  checker_at             TIMESTAMPTZ,

  -- resubmission window (7 days) and mock core-banking result
  resubmission_deadline  TIMESTAMPTZ,
  core_customer_id       TEXT,
  core_account_id        TEXT,

  application_date       DATE        NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date), -- IST calendar date used by the rules
  resubmission_count     INTEGER     NOT NULL DEFAULT 0,

  -- optimistic concurrency: every officer/checker update must send the version it read (409 on mismatch)
  version                INTEGER     NOT NULL DEFAULT 1,
  submitted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX applications_user_idx   ON applications (user_id);
CREATE INDEX applications_status_idx ON applications (status);

-- ---------------------------------------------------------------- documents
-- File bytes live on disk (UPLOAD_DIR); the DB keeps the safe random file name, size and SHA-256.
CREATE TABLE documents (
  id                        SERIAL PRIMARY KEY,
  application_id            TEXT        NOT NULL REFERENCES applications (id),
  doc_id                    TEXT        NOT NULL,       -- HCL document id; mock extraction is looked up by this
  declared_type             TEXT        NOT NULL CHECK (declared_type IN
                              ('PAN_CARD', 'AADHAAR_CARD', 'ELECTRICITY_BILL', 'BANK_STATEMENT', 'DRIVING_LICENCE')),
  original_filename         TEXT        NOT NULL,
  sha256                    TEXT        NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes                INTEGER     NOT NULL,
  storage_path              TEXT        NOT NULL,       -- random file name relative to UPLOAD_DIR
  version                   INTEGER     NOT NULL DEFAULT 1,   -- upload round (resubmission = 2, 3, ...)
  superseded                BOOLEAN     NOT NULL DEFAULT FALSE, -- old versions are kept for audit, never deleted
  classified_type           TEXT,                       -- filled by extraction (Person 2)
  classification_confidence NUMERIC(4, 2),
  uploaded_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, sha256)                       -- same file twice in one application is rejected
);
CREATE UNIQUE INDEX documents_active_docid_idx ON documents (application_id, doc_id) WHERE superseded = FALSE;
CREATE INDEX documents_application_idx ON documents (application_id);

-- ---------------------------------------------------------------- extracted_fields
-- One row per (document, field). Officer corrections overwrite value, set source = 'OFFICER', confidence = 1.00.
CREATE TABLE extracted_fields (
  id                  SERIAL PRIMARY KEY,
  application_id      TEXT        NOT NULL REFERENCES applications (id),
  document_id         INTEGER     NOT NULL REFERENCES documents (id),   -- the exact upload (a resubmitted doc_id is a new row)
  doc_id              TEXT        NOT NULL,
  doc_type            TEXT,
  field               TEXT        NOT NULL,
  value               TEXT,
  confidence          NUMERIC(4, 2) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  source              TEXT        NOT NULL DEFAULT 'MOCK' CHECK (source IN ('MOCK', 'OFFICER', 'AI')),
  original_value      TEXT,                                  -- what the extractor produced, kept after an officer correction
  original_confidence NUMERIC(4, 2),
  corrected_by        INTEGER     REFERENCES users (id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, field)
);
CREATE INDEX extracted_fields_app_idx ON extracted_fields (application_id);

-- ---------------------------------------------------------------- reference data (Person 2 loads the HCL files)
CREATE TABLE sanctions_entries (
  id          SERIAL PRIMARY KEY,
  list_id     TEXT,
  name        TEXT   NOT NULL,
  aliases     TEXT[] NOT NULL DEFAULT '{}',
  dob         DATE,                                -- NULL = unknown, which still counts as a MATCH on a strong name hit
  nationality TEXT,
  program     TEXT
);

CREATE TABLE pep_entries (
  id       SERIAL PRIMARY KEY,
  pep_id   TEXT,
  name     TEXT   NOT NULL,
  aliases  TEXT[] NOT NULL DEFAULT '{}',
  dob      DATE,
  position TEXT,
  category TEXT
);

CREATE TABLE existing_customers (
  id          SERIAL PRIMARY KEY,
  customer_id TEXT,
  name        TEXT,
  pan         TEXT NOT NULL,
  dob         DATE
);
CREATE INDEX existing_customers_pan_idx ON existing_customers (pan);

CREATE TABLE occupations (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH'))
);

-- Mirror of case_02_rules_config_V1.0.json so a Compliance Officer can change thresholds at runtime.
CREATE TABLE rule_config (
  key        TEXT PRIMARY KEY,
  value      JSONB       NOT NULL,
  version    INTEGER     NOT NULL DEFAULT 1,
  updated_by INTEGER     REFERENCES users (id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- audit (append-only)
CREATE TABLE audit_events (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    INTEGER     REFERENCES users (id),        -- NULL for anonymous events (e.g. failed login)
  role        TEXT,
  application_id TEXT,                                  -- set whenever the event belongs to an application
  document_id    TEXT,                                  -- HCL doc_id when the event is about one document
  event_type  TEXT        NOT NULL,
  entity_type TEXT        NOT NULL,
  entity_id   TEXT,
  old_value   JSONB,
  new_value   JSONB,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx  ON audit_events (entity_type, entity_id);
CREATE INDEX audit_application_idx ON audit_events (application_id, id);
CREATE INDEX audit_created_idx ON audit_events (created_at);

CREATE FUNCTION audit_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
