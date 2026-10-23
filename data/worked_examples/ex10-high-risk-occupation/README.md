# Worked example 10: high-risk occupation

Sample application **A2000010**. Run the app with `APPLICATION_DATE=2026-03-04` (see `.env.example`) so it is dated like the case document.

## Form values

- full_name: `Fatima Khan`
- dob: `1985-12-12`
- gender: `FEMALE`
- pan_number: `ZZFPK7788H`
- aadhaar_last4: `1357`
- mobile: `9800079190`
- email: `fatima.khan@example.org`
- address: `Flat 12, Lotus Residency, MG Road, Mumbai`
- city: `Mumbai`
- state: `Maharashtra`
- pincode: `400001`
- occupation_code: `JEWELLER_BULLION_DEALER`
- annual_income: `900000`

## Upload (declared type for each file)

- `D3000028.txt` as `PAN_CARD`
- `D3000029.txt` as `AADHAAR_CARD`
- `D3000030.txt` as `DRIVING_LICENCE`

## Expected result (case document, Section 6.4)

APPROVE, no reason codes, risk HIGH, re-KYC 2028-03-04. Status PENDING_CHECKER (a HIGH-risk approval needs the checker).
