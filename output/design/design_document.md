# OnboardIQ design document

Case 02, Full Stack Web Engineer track. This is the entry point; the detail is in the files linked from each section.

## 1. What was built

A savings-account onboarding application: an applicant submits details and synthetic documents; an extraction service (mock provider) reads the documents; a deterministic rules engine (R1 to R17) returns APPROVE / REVIEW / REJECT with every reason code, a name-match score, a risk category and a re-KYC date; people handle the exceptions through a maker-checker flow; a mock core-banking API opens the account; every step is written to an append-only audit trail. The same engine runs in a batch command that writes `output/decisions_output.csv`.

## 2. R1 to R17 evaluation and routing (flowchart)

See [rules.md](rules.md): the flowchart, every rule with its condition and outcome, the risk and re-KYC table, routing and the configuration keys.

## 3. Status lifecycle and data model

- [state-machine.md](state-machine.md): all ten statuses, every allowed transition, who moves what.
- [er-diagram.md](er-diagram.md): tables, relationships and the integrity rules the database enforces.

## 4. Extraction-service interface

The extraction step is a provider interface chosen by configuration (`EXTRACTION_PROVIDER=mock | ai`); switching needs no code change.

**Endpoint** `POST /api/v1/documents/{doc_id}/extract` (signed-in user, or the backend itself with header `x-service-key`). Optional body `{ "application_id": "A3000001" }`.

Response (long format of the case document: one `doc_type` row plus one row per field):

```json
{
  "doc_id": "D3000010",
  "provider": "mock",
  "doc_type": "PAN_CARD",
  "confidence": 0.98,
  "fields": [
    { "field_name": "name", "value": "RAVI K SHARMA", "confidence": 0.97 },
    { "field_name": "dob", "value": "1988-07-21", "confidence": 0.97 },
    { "field_name": "pan_number", "value": "ZZRPS4521L", "confidence": 0.97 }
  ],
  "rows": [
    { "doc_id": "D3000010", "field_name": "doc_type", "value": "PAN_CARD", "confidence": 0.98 },
    { "doc_id": "D3000010", "field_name": "name", "value": "RAVI K SHARMA", "confidence": 0.97 }
  ],
  "stored": false
}
```

- **Mock provider** (`services/extraction/mockProvider.js`): reads `data/sample/extraction_mock.csv` (`doc_id,field_name,value,confidence`) and looks the document up by `doc_id`. An unknown `doc_id` returns `doc_type = OTHER`, confidence `0.00`, no fields. It never errors.
- **AI provider** (`services/extraction/aiProvider.js`): `POST AI_EXTRACTION_URL` with `{ doc_id, text }`, expects `{ doc_type, confidence, fields: { name: { value, confidence } } }`. Out of scope for this track; present so the switch needs no code change.
- **Document types:** `PAN_CARD`, `AADHAAR_CARD`, `ELECTRICITY_BILL`, `BANK_STATEMENT`, `DRIVING_LICENCE`, `OTHER`. **Fields:** `name`, `dob`, `gender`, `pan_number`, `aadhaar_last4`, `address`, `pincode`, `document_date`, `valid_until`.
- If a provider call fails, the document is treated as unreadable and the case goes to a human; a customer is never rejected because a service was down.

## 5. API documentation

[openapi.yaml](openapi.yaml) (OpenAPI 3.0.3, paste into https://editor.swagger.io) and the human-readable [contract.md](../../contract.md) at the repository root.

## 6. Architecture, security and technology decisions

- [architecture.md](architecture.md): components, submission pipeline, maker-checker, concurrency, technology choices.
- [security.md](security.md): controls in place and the limits accepted for a synthetic-data demo.

## 7. Assumptions

[ASSUMPTIONS.md](../../ASSUMPTIONS.md) lists every place where the case document or the data pack left room for interpretation, and what to check when the HCL data pack is available.

## 8. How to verify against the case

[VERIFY_AGAINST_CASE.md](../../VERIFY_AGAINST_CASE.md) maps every functional requirement, non-functional requirement, worked example and deliverable to a command or a click path.
