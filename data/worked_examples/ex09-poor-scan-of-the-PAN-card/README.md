# Worked example 9: poor scan of the PAN card

Sample application **A2000009**. Run the app with `APPLICATION_DATE=2026-03-04` (see `.env.example`) so it is dated like the case document.

## Form values

- full_name: `Tanya Sethi`
- dob: `1991-04-09`
- gender: `FEMALE`
- pan_number: `ZZTPS9012Y`
- aadhaar_last4: `4096`
- mobile: `9800071271`
- email: `tanya.sethi@example.org`
- address: `Flat 12, Lotus Residency, MG Road, Mumbai`
- city: `Mumbai`
- state: `Maharashtra`
- pincode: `400001`
- occupation_code: `SALARIED_PRIVATE`
- annual_income: `900000`

## Upload (declared type for each file)

- `D3000025.txt` as `PAN_CARD`
- `D3000026.txt` as `AADHAAR_CARD`
- `D3000027.txt` as `ELECTRICITY_BILL`

## Expected result (case document, Section 6.4)

REVIEW, LOW_EXTRACTION_CONFIDENCE. PAN_MISMATCH is NOT evaluated because the pan_number field is not usable (0.62). Status IN_REVIEW.
