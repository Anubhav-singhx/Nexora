# ASSUMPTIONS.md

The case document (`case_02_OnboardIQ_V1.0.docx`) was available; the HCL **data pack** (sample applications, extraction files, watchlists, `case_02_rules_config_V1.0.json`) was not. Everything was built from the written rules and our own synthetic data. These are the places where we had to choose. **Check each against the HCL files the day they arrive**; most are one-line changes in `code/server/src/services/kyc/` or `data/`.

## Must verify against the HCL data pack

| # | Assumption | Where it lives |
|---|---|---|
| 1 | File formats were inferred from the data dictionary in the case: the mock extraction file is long format `doc_id,field_name,value,confidence` with one `doc_type` row per document; document types are `PAN_CARD`, `AADHAAR_CARD`, `ELECTRICITY_BILL`, `BANK_STATEMENT`, `DRIVING_LICENCE`; fields are `name, dob, gender, pan_number, aadhaar_last4, address, pincode, document_date, valid_until` | `services/extraction/mockProvider.js`, `constants.js` |
| 2 | Application, document, watchlist, existing-customer and occupation files use the column names in `data/sample/` and `data/reference/` (`application_id, application_date, full_name, dob, gender, pan_number, aadhaar_last4, mobile, email, address, city, state, pincode, occupation_code, annual_income`; documents: `doc_id, application_id, file_name, declared_doc_type`). Reference loaders also accept the HCL file names `case_02_sanctions_list*.csv`, `case_02_pep_list*.csv`, `case_02_existing_customers*.csv`, `case_02_occupations*.csv`, `case_02_rules_config*.json` | `services/kyc/references.js`, `batch.js` |
| 3 | **The key names inside `case_02_rules_config_V1.0.json` are unknown.** The loader reads our own key names and also recognises many other spellings (for example `name_match: { pass, reject_below }`, `rekyc_years_high`). Anything it cannot map is reported on the console and left at the case document's defaults, never dropped silently | `services/kyc/config.js` (`mapConfigFile`) |
| 4 | Batch output joins several reason codes with `\|` and writes the six columns in the order of the case document; REJECT rows have empty `risk_category` and `rekyc_due_date`; scores have 4 decimals | `services/kyc/batch.js` |
| 5 | The 60-application sample in `data/sample/` is **our own synthetic set** (applications A2000001 to A2000010 reproduce the ten worked examples exactly as printed in the case). Its expected columns were produced by an independent Python implementation (`data/tools/generate_sample_data.py`), not by the engine. The statement "all 60 HCL sample applications match" can only be proven by pointing `npm run batch` at their files | `data/sample/`, `data/tools/` |
| 6 | The application date of the worked examples is 2026-03-04. In normal use the application date is today's date in IST; `APPLICATION_DATE=YYYY-MM-DD` overrides it so the examples can be reproduced | `utils/clock.js`, `.env.example` |
| 7 | Gender is stored as `MALE`, `FEMALE` or `OTHER`; `M`/`F`/`O` are accepted and converted | `validators/application.js` |

## Interpretation choices in the rules

- **R1 "usable document".** A document counts as usable for R1 when it was selected for its classified type (lowest `doc_id` per type; address proof across the three address types) and its type confidence is at least 0.80. A document that is usable but has missing or weak fields triggers R3, not R1.
- **Unknown occupation code** counts as LOW risk (configurable with `unknown_occupation_risk`). The application form only offers codes from the occupation list.
- **PAN entered in lower case** is converted to upper case by the form validation; the engine itself compares exactly what it is given.
- **R6 to R14** are skipped when their field is not usable, as the case document says; a poor scan therefore leads to review (R3) and never to rejection.
- **R12 and R13** use the selected address proof only (`valid_until` for a driving licence, `document_date` for a bill or statement). A document dated after the application date is stale. Exactly 90 days is fine.
- **Name score** is the lowest similarity over the usable PAN and Aadhaar names; empty when neither is usable. Compared unrounded; 4 decimals only in output. Reject threshold is never allowed above the pass threshold in configuration.
- **Watchlists** are compared on name and each alias. PEP POSSIBLE results trigger no rule (the case defines R16 for MATCH only) but are shown to officers as evidence.
- **R17** compares the declared PAN with the existing-customer list.
- **Duplicate upload.** Uploading the same file content (same SHA-256) twice for one application is refused with 409 `DUPLICATE_DOCUMENT` and nothing is stored. The case asks that it "does not create a duplicate document"; we interpret a clear refusal as satisfying that.
- **Reviewed or corrected approvals.** If the rules say APPROVE after an officer corrected a field or the applicant resubmitted, the case goes to `PENDING_CHECKER` (the case: "the case still goes to the checker").

## Product choices

- Officer corrections are stored with confidence 1.00, source `OFFICER`, original value kept, and are never overwritten by re-extraction.
- The checker cannot approve a case they recommended (403). A compliance officer may also work the review queue, which is how worked example 11 is reproduced with two compliance accounts. Sending a case back clears the earlier recommendation.
- Customers see generic messages for watchlist, duplicate and risk reasons; they never see scores, confidences or list names.
- Resubmission window is 7 days and checker SLA 24 hours (both configurable). Expiry is enforced on read and by a 5-minute background job; items past the SLA are flagged overdue in the sign-off queue.
- Core banking is a mock service inside the API (also reachable over HTTP at `/mock-core-banking`, protected by `x-api-key`). If it fails, a checker approval changes nothing and can be retried; an automatic approval keeps its approval and the account can be retried by the compliance officer.
- JWTs are kept in `localStorage`; acceptable for a local synthetic-data demo.
- Documents are UTF-8 `.txt` files (1 MB max, 3 to 10 per application). Real OCR and the AI track are out of scope; the extraction provider interface is where they would plug in.
- Docker files are included but could not be run in the build environment (no Docker daemon); the native PostgreSQL route was the tested one.
