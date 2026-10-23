# Worked example 2: under 18

Sample application **A2000002**. Run the app with `APPLICATION_DATE=2026-03-04` (see `.env.example`) so it is dated like the case document.

## Form values

- full_name: `Kavya Iyer`
- dob: `2008-09-10`
- gender: `FEMALE`
- pan_number: `ZZKPI2468K`
- aadhaar_last4: `3187`
- mobile: `9800015838`
- email: `kavya.iyer@example.org`
- address: `Flat 12, Lotus Residency, MG Road, Mumbai`
- city: `Mumbai`
- state: `Maharashtra`
- pincode: `400001`
- occupation_code: `STUDENT`
- annual_income: `900000`

## Upload (declared type for each file)

- `D3000004.txt` as `PAN_CARD`
- `D3000005.txt` as `AADHAAR_CARD`
- `D3000006.txt` as `ELECTRICITY_BILL`

## Expected result (case document, Section 6.4)

REJECT, AGE_BELOW_18, score 1.0000, risk and re-KYC empty. Status AUTO_REJECTED.
