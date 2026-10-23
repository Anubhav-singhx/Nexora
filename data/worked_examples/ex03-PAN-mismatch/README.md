# Worked example 3: PAN mismatch

Sample application **A2000003**. Run the app with `APPLICATION_DATE=2026-03-04` (see `.env.example`) so it is dated like the case document.

## Form values

- full_name: `Meera Nair`
- dob: `1992-11-02`
- gender: `FEMALE`
- pan_number: `ZZMPN3456S`
- aadhaar_last4: `5902`
- mobile: `9800023757`
- email: `meera.nair@example.org`
- address: `Flat 12, Lotus Residency, MG Road, Mumbai`
- city: `Mumbai`
- state: `Maharashtra`
- pincode: `400001`
- occupation_code: `SALARIED_PRIVATE`
- annual_income: `900000`

## Upload (declared type for each file)

- `D3000007.txt` as `PAN_CARD`
- `D3000008.txt` as `AADHAAR_CARD`
- `D3000009.txt` as `ELECTRICITY_BILL`

## Expected result (case document, Section 6.4)

REJECT, PAN_MISMATCH. Status AUTO_REJECTED.
