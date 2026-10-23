# Worked example 8: wrong document type

Sample application **A2000008**. Run the app with `APPLICATION_DATE=2026-03-04` (see `.env.example`) so it is dated like the case document.

## Form values

- full_name: `Arjun Reddy`
- dob: `1993-08-19`
- gender: `MALE`
- pan_number: `ZZAPR6612N`
- aadhaar_last4: `8841`
- mobile: `9800063352`
- email: `arjun.reddy@example.org`
- address: `Flat 12, Lotus Residency, MG Road, Mumbai`
- city: `Mumbai`
- state: `Maharashtra`
- pincode: `400001`
- occupation_code: `SALARIED_PRIVATE`
- annual_income: `900000`

## Upload (declared type for each file)

- `D3000022.txt` as `PAN_CARD`
- `D3000023.txt` as `AADHAAR_CARD`
- `D3000024.txt` as `ELECTRICITY_BILL`

## Expected result (case document, Section 6.4)

REVIEW, DOCUMENT_MISSING|DOCUMENT_TYPE_MISMATCH, score 1.0000 (PAN only), risk LOW. Status IN_REVIEW.
