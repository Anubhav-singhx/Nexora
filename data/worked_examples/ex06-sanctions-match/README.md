# Worked example 6: sanctions match

Sample application **A2000006**. Run the app with `APPLICATION_DATE=2026-03-04` (see `.env.example`) so it is dated like the case document.

## Form values

- full_name: `Valko Quillon`
- dob: `1986-02-23`
- gender: `MALE`
- pan_number: `ZZVPQ4455R`
- aadhaar_last4: `7733`
- mobile: `9800047514`
- email: `valko.quillon@example.org`
- address: `Flat 12, Lotus Residency, MG Road, Mumbai`
- city: `Mumbai`
- state: `Maharashtra`
- pincode: `400001`
- occupation_code: `SALARIED_PRIVATE`
- annual_income: `900000`

## Upload (declared type for each file)

- `D3000016.txt` as `PAN_CARD`
- `D3000017.txt` as `AADHAAR_CARD`
- `D3000018.txt` as `ELECTRICITY_BILL`

## Expected result (case document, Section 6.4)

REJECT, SANCTIONS_MATCH (entry SAN0002). Status AUTO_REJECTED.
