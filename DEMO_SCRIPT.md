# Demo script (about 10 minutes)

Before you start: set `APPLICATION_DATE=2026-03-04` in `.env`, run `npm run seed`, then `npm run dev`. Open <http://localhost:5173> in a normal window and keep a second window (or a private window) ready for the second user. The files and form values for every scenario are in `data/worked_examples/` (one folder per worked example of the case document).

## The story in one sentence

"A customer opens a savings account in minutes; a rules engine decides what it can and explains why; people only handle the exceptions; and every step is audited."

## Run of show

| Min | Who | Do | Say |
|---|---|---|---|
| 0:00 | Sign-in page | Point at the demo buttons | "Customer, KYC officer, and two independent compliance officers." |
| 0:30 | Applicant | Example 1 (clean): fill the form, drop the 3 files, tick consent, submit | "The checklist on the right fills as I go. Document types are suggested from the file content." |
| 1:30 | Applicant | The tracker flips to a green **Approved** stamp with an account number | "No human touched this. Extraction, 17 rules, risk, and a mock core-banking account, in seconds." |
| 2:00 | Applicant | Example 6 (sanctions): submit | "Rejected. The customer sees one generic sentence: no list names, no scores. We never tip off a sanctioned person." |
| 3:00 | Applicant | Example 9 (poor scan of the PAN card): submit; lands **In review** | "The PAN was read at 0.62 confidence. We never reject on bad data; we send it to a person." Then submit examples 4, 7 and 10 while talking |
| 4:30 | KYC officer (second window) | Open **Review queue** | "The PEP case is first because it is high risk." |
| 5:00 | KYC officer | Open example 9. Show the **Rule verdict**: R3 with the reason. Documents: PAN number, confidence in red. Press **Fix**, type `ZZTPS9012Y`, reason "Read from the original scan", save | "One correction re-runs all 17 rules. The toast says REVIEW became APPROVE. The original value is kept in the audit trail." |
| 6:00 | | The case now says **Final sign-off** | "Even though the rules now approve, a human touched it, so a second person must sign: maker-checker." |
| 6:30 | Compliance | Sign in as Compliance. **Sign-off queue** shows example 9 and example 10 (jeweller: approved by the rules, but high risk so a person must sign) | |
| 7:00 | Compliance | Open example 10, **Approve and open account**, confirm | "The account opens in core banking first; if that fails nothing changes and we can retry." Show the account number |
| 7:30 | Compliance, then Compliance 2 | On example 4: *Review queue*, recommend approval; then try to decide it from *Sign-off queue*: refused. Sign in as Compliance 2 and approve | "Maker and checker must differ: the API returns 403, not just the UI." |
| 8:30 | Compliance | **Dashboard** | "Every number is computed from stored rows; this box explains how." Open "How these numbers are calculated" |
| 9:00 | Compliance | **Audit trail**: filter by application; open a case, **Export CSV** | "Append-only, enforced by a database trigger. PANs are masked in exports." |
| 9:30 | Compliance | **Rules and lists**: change the name reject threshold, add a sanctions entry, **Re-screen** | "Policy changes without a deployment, and open cases are re-checked against the new list." |
| 10:00 | | Close | "The same engine runs in batch: `npm run batch` produced the 60-application decisions file and matched the expected columns 60 of 60." |

## Questions you may get

- **"Where is the AI?"** The extraction step is a provider interface; the mock reads a CSV today, and `EXTRACTION_PROVIDER=ai` points it at a real model service with the same JSON shape. The decision logic is deliberately deterministic rules, because regulators need reasons, not scores.
- **"Can one person approve their own recommendation?"** No. The API returns 403, not just the UI.
- **"What if two reviewers open the same case?"** Each save carries the version it read; the second one gets a clear conflict message. There is a test with two simultaneous requests: exactly one wins.
- **"What if core banking is down?"** The checker's approval changes nothing and can be retried; automatic approvals keep their approval and the account is retried idempotently.
- **"What data is real?"** None. All names, PANs and documents are synthetic.

## If something goes wrong live

| Problem | Quick fix |
|---|---|
| An example is not approved because the bill is "stale" | `APPLICATION_DATE=2026-03-04` is not set in `.env`, or the API was not restarted after setting it |
| The queues are cluttered from rehearsals | `npm run seed` between rehearsals |
| You want a clean slate | `npm run seed` (resets everything, keeps users and reference data) |
