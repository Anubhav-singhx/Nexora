# Worked example 4: name differs slightly

Sample application **A2000004**. Run the app with `APPLICATION_DATE=2026-03-04` (see `.env.example`) so it is dated like the case document.

## Form values

- full_name: `Ravi Kumar Sharma`
- dob: `1988-07-21`
- gender: `MALE`
- pan_number: `ZZRPS4521L`
- aadhaar_last4: `3344`
- mobile: `9800031676`
- email: `ravi.kumar.sharma@example.org`
- address: `Flat 12, Lotus Residency, MG Road, Mumbai`
- city: `Mumbai`
- state: `Maharashtra`
- pincode: `400001`
- occupation_code: `SALARIED_PRIVATE`
- annual_income: `900000`

## Upload (declared type for each file)

- `D3000010.txt` as `PAN_CARD`
- `D3000011.txt` as `AADHAAR_CARD`
- `D3000012.txt` as `ELECTRICITY_BILL`

## Expected result (case document, Section 6.4)

REVIEW, NAME_MISMATCH_MINOR, score 0.7647, risk LOW, re-KYC 2036-03-04. Status IN_REVIEW.
