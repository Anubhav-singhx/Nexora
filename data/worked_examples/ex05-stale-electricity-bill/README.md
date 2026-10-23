# Worked example 5: stale electricity bill

Sample application **A2000005**. Run the app with `APPLICATION_DATE=2026-03-04` (see `.env.example`) so it is dated like the case document.

## Form values

- full_name: `Sanjana Rao`
- dob: `1995-01-30`
- gender: `FEMALE`
- pan_number: `ZZSPR7788E`
- aadhaar_last4: `6150`
- mobile: `9800039595`
- email: `sanjana.rao@example.org`
- address: `Flat 12, Lotus Residency, MG Road, Mumbai`
- city: `Mumbai`
- state: `Maharashtra`
- pincode: `400001`
- occupation_code: `SALARIED_PRIVATE`
- annual_income: `900000`

## Upload (declared type for each file)

- `D3000013.txt` as `PAN_CARD`
- `D3000014.txt` as `AADHAAR_CARD`
- `D3000015.txt` as `ELECTRICITY_BILL`

## Expected result (case document, Section 6.4)

REVIEW, ADDRESS_PROOF_STALE, score 1.0000, risk LOW. Status IN_REVIEW.
