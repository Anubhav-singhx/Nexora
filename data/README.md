# data/

| Folder | What it holds |
|---|---|
| `reference/` | Sanctions list, PEP list, existing customers, occupations (with risk level) and `rules_config.json`. These are **synthetic stand-ins**. Drop the HCL files in with their own names (`case_02_sanctions_list*.csv`, `case_02_pep_list*.csv`, `case_02_existing_customers*.csv`, `case_02_occupations*.csv`, `case_02_rules_config_V1.0.json`) and `npm run seed` / `npm run batch` will pick them up |
| `sample/` | 60 applications (`applications.csv` with `expected_*` columns), their 180 documents (`documents.csv`, `document_text.jsonl`), the mock extraction file (`extraction_mock.csv`) and analyst notes (`case_notes.csv`). Applications A2000001 to A2000010 are the ten worked examples of the case document |
| `worked_examples/` | One folder per worked example of the case (1 to 12): the form values, the .txt files to upload and the expected result |
| `tools/generate_sample_data.py` | Independent Python implementation of the rules that wrote the `expected_*` columns. `python3 data/tools/generate_sample_data.py` regenerates everything in `sample/` and `worked_examples/` (it is deterministic) |

All people, PANs, Aadhaar digits and documents are fictional. Every document carries the line "SYNTHETIC SPECIMEN - NOT A VALID DOCUMENT".
