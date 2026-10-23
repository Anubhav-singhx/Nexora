# Worked example 1: clean applicant

Sample application **A2000001**. Run the app with `APPLICATION_DATE=2026-03-04` (see `.env.example`) so it is dated like the case document.

## Form values

- full_name: `Ravi Kumar Sharma`
- dob: `1990-05-15`
- gender: `MALE`
- pan_number: `ZZKPS1234Q`
- aadhaar_last4: `4821`
- mobile: `9800007919`
- email: `ravi.kumar.sharma@example.org`
- address: `Flat 12, Lotus Residency, MG Road, Mumbai`
- city: `Mumbai`
- state: `Maharashtra`
- pincode: `400001`
- occupation_code: `SALARIED_PRIVATE`
- annual_income: `900000`

## Upload (declared type for each file)

- `D3000001.txt` as `PAN_CARD`
- `D3000002.txt` as `AADHAAR_CARD`
- `D3000003.txt` as `ELECTRICITY_BILL`

## Expected result (case document, Section 6.4)

APPROVE, no reason codes, score 1.0000, risk LOW, re-KYC 2036-03-04. Status AUTO_APPROVED.
