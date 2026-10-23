# Worked examples 1 to 12

The twelve examples of Section 9 of the case document. Each folder has a `README.md` with the form values, the files to upload (the file name without `.txt` is the document id the mock extractor looks up) and the expected result.

**Before using them in the browser** set `APPLICATION_DATE=2026-03-04` in `.env` and restart `npm run dev`; the examples are dated 2026-03-04. Empty the setting again afterwards. The automated tests set it for you.

| # | Folder | Expected |
|---|---|---|
| 1 | `ex01-clean-applicant` | APPROVE, LOW, re-KYC 2036-03-04, status AUTO_APPROVED |
| 2 | `ex02-under-18` | REJECT, AGE_BELOW_18 |
| 3 | `ex03-PAN-mismatch` | REJECT, PAN_MISMATCH |
| 4 | `ex04-name-differs-slightly` | REVIEW, NAME_MISMATCH_MINOR, score 0.7647 |
| 5 | `ex05-stale-electricity-bill` | REVIEW, ADDRESS_PROOF_STALE |
| 6 | `ex06-sanctions-match` | REJECT, SANCTIONS_MATCH (entry SAN0002) |
| 7 | `ex07-PEP-match` | REVIEW, PEP_MATCH (entry PEP0001), HIGH, re-KYC 2028-03-04 |
| 8 | `ex08-wrong-document-type` | REVIEW, DOCUMENT_MISSING and DOCUMENT_TYPE_MISMATCH |
| 9 | `ex09-poor-scan-of-the-PAN-card` | REVIEW, LOW_EXTRACTION_CONFIDENCE |
| 10 | `ex10-high-risk-occupation` | APPROVE but HIGH risk, status PENDING_CHECKER |
| 11 | `ex11-maker-and-checker-must-differ` | Needs two compliance accounts: the recommending officer gets 403 as checker; another approves |
| 12 | `ex12-officer-corrects-the-PAN-of-example-9` | Correct `pan_number` on D3000025 to `ZZTPS9012Y`: APPROVE, no codes, PENDING_CHECKER |

Example 11 in the browser: submit example 4 as the applicant. Sign in as `checker@demo.com` (a compliance officer may also work the review queue: use *Review queue* in the top bar), recommend approval of the case with a comment, then open the same case from *Sign-off queue* and try to decide it: you are refused (403). Sign out and sign in as `checker2@demo.com` (button *Compliance 2*): approving now succeeds and the mock core-banking API returns a customer id and an account number. The automated test `code/server/tests/case.test.js` does exactly this.
