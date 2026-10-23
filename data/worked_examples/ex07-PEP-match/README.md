# Worked example 7: PEP match

Sample application **A2000007**. Run the app with `APPLICATION_DATE=2026-03-04` (see `.env.example`) so it is dated like the case document.

## Form values

- full_name: `Zoya Menon`
- dob: `1982-10-15`
- gender: `FEMALE`
- pan_number: `ZZZPM3321K`
- aadhaar_last4: `2209`
- mobile: `9800055433`
- email: `zoya.menon@example.org`
- address: `Flat 12, Lotus Residency, MG Road, Mumbai`
- city: `Mumbai`
- state: `Maharashtra`
- pincode: `400001`
- occupation_code: `SALARIED_PRIVATE`
- annual_income: `900000`

## Upload (declared type for each file)

- `D3000019.txt` as `PAN_CARD`
- `D3000020.txt` as `AADHAAR_CARD`
- `D3000021.txt` as `ELECTRICITY_BILL`

## Expected result (case document, Section 6.4)

REVIEW, PEP_MATCH (entry PEP0001), risk HIGH, re-KYC 2028-03-04. Status IN_REVIEW.
