# Data model

```mermaid
erDiagram
  users ||--o{ applications : "applies (user_id)"
  users ||--o{ applications : "maker_id / checker_id"
  applications ||--o{ documents : has
  documents ||--o{ extracted_fields : "one row per field"
  users ||--o{ extracted_fields : "corrected_by"
  applications ||--o{ audit_events : "application_id"
  users ||--o{ audit_events : "actor_id"
  users ||--o{ rule_config : "updated_by"

  users {
    int id PK
    text name
    text email UK
    text password_hash
    text role "APPLICANT | KYC_OFFICER | COMPLIANCE_OFFICER"
  }
  applications {
    text id PK "A3000001"
    int user_id FK
    text full_name
    date dob
    text gender "MALE | FEMALE | OTHER"
    text pan "pan_number in the API"
    text aadhaar_last4
    text mobile
    text email
    text address
    text city
    text state
    text pincode
    text occupation "occupation_code in the API"
    numeric annual_income
    text status "10 values"
    text decision "APPROVE | REVIEW | REJECT"
    text_array reason_codes
    numeric name_match_score
    text risk_category
    date rekyc_due_date
    jsonb evaluation "full rule trace"
    int maker_id FK
    int checker_id FK
    timestamptz resubmission_deadline
    text core_account_id
    date application_date "IST"
    int resubmission_count
    int version "optimistic lock"
  }
  documents {
    int id PK
    text application_id FK
    text doc_id "key for the extractor"
    text declared_type
    text classified_type
    numeric classification_confidence
    text sha256
    text storage_path "random uuid.txt"
    int version "upload round"
    bool superseded
  }
  extracted_fields {
    int id PK
    int document_id FK
    text field
    text value
    numeric confidence
    text source "MOCK | OFFICER | AI"
    numeric original_confidence
    text original_value
    int corrected_by FK
  }
  audit_events {
    bigint id PK
    int actor_id FK
    text role
    text application_id
    text document_id
    text event_type
    jsonb old_value
    jsonb new_value
    jsonb details
    timestamptz created_at
  }
  rule_config {
    text key PK
    jsonb value
    int version
  }
  sanctions_entries {
    int id PK
    text list_id
    text name
    text_array aliases
    date dob
  }
  pep_entries {
    int id PK
    text pep_id
    text name
    text_array aliases
    date dob
    text position
  }
  existing_customers {
    int id PK
    text customer_id
    text pan
  }
  occupations {
    text code PK
    text name
    text risk_level
  }
```

`sanctions_entries`, `pep_entries`, `existing_customers` and `occupations` are reference data read by the engine; they have no foreign keys to applications on purpose, so editing a list never alters history. What the engine saw is preserved in `applications.evaluation` and the `EVALUATED` audit rows.

## Integrity rules enforced by the database

- `pan`, `aadhaar_last4`, `pincode`, `mobile` formats and `consent = TRUE` are CHECK constraints.
- `UNIQUE (application_id, sha256)`: the same file cannot be attached twice. A partial unique index keeps one active document per `doc_id`.
- `UNIQUE (document_id, field)`: one value per extracted field; officer corrections upsert and keep the original value.
- `audit_events` has a trigger that raises an exception on UPDATE or DELETE.
- Application ids come from a sequence (`A3000001`, ...), so they never clash with the sample ids (`A2000001`...).
