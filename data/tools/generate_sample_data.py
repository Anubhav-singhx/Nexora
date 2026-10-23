#!/usr/bin/env python3
"""
Optional developer tool - you do NOT need Python to run OnboardIQ. The files it writes are already committed.

Builds the synthetic data set that stands in for the HCL data pack (which is not part of this repository):
  data/reference/*            sanctions, PEP, existing customers, occupations, rules config   (case Section 4 layouts)
  data/sample/*               60 applications with expected_* columns, documents, mock extraction, document text
  data/worked_examples/*      the 12 worked examples of the case document, ready to upload through the web UI

The expected_* columns are produced by an INDEPENDENT re-implementation of the case rules written below in plain
Python (no code shared with the Node engine), so running the Node batch over this data is a genuine cross-check.
Examples 1-10 are additionally asserted against the exact results printed in the case document.
"""
import csv, json, os, shutil, sys
from datetime import date, timedelta

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
APP_DATE = date(2026, 3, 4)

# ------------------------------------------------------------------------------------------------ reference data
OCCUPATIONS = [
    ('SALARIED_PRIVATE', 'Salaried - private sector', 'LOW'),
    ('SALARIED_GOVERNMENT', 'Salaried - government', 'LOW'),
    ('STUDENT', 'Student', 'LOW'),
    ('HOMEMAKER', 'Homemaker', 'LOW'),
    ('RETIRED', 'Retired', 'LOW'),
    ('AGRICULTURIST', 'Agriculturist', 'LOW'),
    ('SELF_EMPLOYED_PROFESSIONAL', 'Self-employed professional', 'MEDIUM'),
    ('BUSINESS_OWNER', 'Business owner', 'MEDIUM'),
    ('TRADER_CASH_INTENSIVE', 'Trader - cash intensive', 'MEDIUM'),
    ('JEWELLER_BULLION_DEALER', 'Jeweller / bullion dealer', 'HIGH'),
    ('REAL_ESTATE_DEALER', 'Real estate dealer', 'HIGH'),
    ('MONEY_CHANGER_FOREX', 'Money changer / forex dealer', 'HIGH'),
]
OCC_RISK = {c: r for c, _, r in OCCUPATIONS}

SANCTIONS = [  # list_id, name, alias, dob, nationality, program
    ('SAN0001', 'Orlan Dravik', 'O Dravik', '1975-04-12', 'XA', 'SYNTHETIC-PROGRAM-A'),
    ('SAN0002', 'Valko Quillon', 'V Quillon', '1986-02-23', 'XA', 'SYNTHETIC-PROGRAM-A'),
    ('SAN0003', 'Teodor Marchek', '', '', 'XB', 'SYNTHETIC-PROGRAM-B'),
    ('SAN0004', 'Ismene Vardakis', 'Ismene V Vardakis', '1990-09-09', 'XC', 'SYNTHETIC-PROGRAM-B'),
    ('SAN0005', 'Bruno Falkenrath', 'B Falkenrath', '1968-12-01', 'XA', 'SYNTHETIC-PROGRAM-C'),
    ('SAN0006', 'Selma Okonkwo-Brandt', 'Selma Brandt', '1981-07-30', 'XB', 'SYNTHETIC-PROGRAM-C'),
    ('SAN0007', 'Cassian Roark Hellmuth', 'C R Hellmuth', '1972-01-19', 'XC', 'SYNTHETIC-PROGRAM-A'),
    ('SAN0008', 'Nadezhka Prolov', 'N Prolov', '', 'XA', 'SYNTHETIC-PROGRAM-B'),
    ('SAN0009', 'Emeric Dunstan Vale', 'E D Vale', '1959-10-03', 'XB', 'SYNTHETIC-PROGRAM-C'),
    ('SAN0010', 'Pavlina Skorzeny', 'P Skorzeny', '1993-05-21', 'XC', 'SYNTHETIC-PROGRAM-A'),
]
PEPS = [  # pep_id, name, dob, position, category
    ('PEP0001', 'Zoya Menon', '1982-10-15', 'Member of Legislative Assembly (fictional)', 'DOMESTIC'),
    ('PEP0002', 'Harish Nambiar', '1960-02-11', 'State Cabinet Minister (fictional)', 'DOMESTIC'),
    ('PEP0003', 'Leena Pradhan', '', 'Municipal Corporation Chair (fictional)', 'DOMESTIC'),
    ('PEP0004', 'Rohit Venkataraman', '1975-08-08', 'Spouse of a Member of Parliament (fictional)', 'RCA'),
    ('PEP0005', 'Gulnaz Abdi', '1988-03-27', 'Daughter of a State Minister (fictional)', 'RCA'),
    ('PEP0006', 'Mandar Kulshreshtha', '1955-12-30', 'Former Governor (fictional)', 'DOMESTIC'),
]
EXISTING = [  # customer_id, full_name, pan_number, dob
    ('C0000101', 'Dinesh Pillai', 'ZZDPP5555D', '1984-06-30'),
    ('C0000102', 'Shalini Bhatt', 'ZZSPB2468H', '1979-01-17'),
    ('C0000103', 'Imran Qadri', 'ZZIPQ1357M', '1991-11-05'),
    ('C0000104', 'Pooja Dandekar', 'ZZPPD8642K', '1987-04-22'),
    ('C0000105', 'Gopal Rastogi', 'ZZGPR9753L', '1969-09-14'),
]
RULES_CONFIG = {
    'min_field_confidence': 0.8,
    'name_match_threshold': 0.9,
    'name_reject_threshold': 0.75,
    'watchlist_match_threshold': 0.9,
    'watchlist_possible_threshold': 0.8,
    'min_age': 18,
    'pan_pattern': '^[A-Z]{5}[0-9]{4}[A-Z]$',
    'pan_holder_char': 'P',
    'address_proof_max_age_days': 90,
    'name_title_tokens': ['MR', 'MRS', 'MS', 'MISS', 'DR', 'SHRI', 'SMT', 'KUMARI'],
    'medium_income_threshold': 2500000,
    'rekyc_years': {'HIGH': 2, 'MEDIUM': 8, 'LOW': 10},
    'resubmission_window_days': 7,
    'checker_sla_hours': 24,
}
TITLES = set(RULES_CONFIG['name_title_tokens'])
MIN_CONF = RULES_CONFIG['min_field_confidence']

# ------------------------------------------------------------------------------------------------ the oracle
def d(s): return date.fromisoformat(s)

def norm_name(n):
    n = n.upper().replace('.', ' ').replace('-', ' ')
    n = ''.join(c for c in n if ('A' <= c <= 'Z') or c == ' ')
    return ' '.join(sorted(t for t in n.split(' ') if t and t not in TITLES))

def lev(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]

def sim(a, b):
    a, b = norm_name(a), norm_name(b)
    m = max(len(a), len(b))
    return 1.0 if m == 0 else 1 - lev(a, b) / m

def age_on(dob, on):
    return on.year - dob.year - ((on.month, on.day) < (dob.month, dob.day))

def add_years(dt, n):
    try: return dt.replace(year=dt.year + n)
    except ValueError: return dt.replace(year=dt.year + n, day=28)

def screen(name, dob, entries):
    status, hits = 'CLEAR', []
    for e in entries:
        best = max(sim(name, x) for x in [e['name']] + ([e['alias']] if e['alias'] else []))
        if best >= 0.8:
            strong = best >= 0.9 and (not e['dob'] or e['dob'] == dob)
            hits.append('MATCH' if strong else 'POSSIBLE')
    if 'MATCH' in hits: status = 'MATCH'
    elif hits: status = 'POSSIBLE'
    return status

REQUIRED = {'PAN_CARD': ['name', 'dob', 'pan_number'], 'AADHAAR_CARD': ['name', 'dob', 'aadhaar_last4'],
            'ELECTRICITY_BILL': ['pincode', 'document_date'], 'BANK_STATEMENT': ['pincode', 'document_date'],
            'DRIVING_LICENCE': ['pincode', 'valid_until']}
ADDRESS_TYPES = ['ELECTRICITY_BILL', 'BANK_STATEMENT', 'DRIVING_LICENCE']
CODES = ['DOCUMENT_MISSING', 'DOCUMENT_TYPE_MISMATCH', 'LOW_EXTRACTION_CONFIDENCE', 'AGE_BELOW_18', 'PAN_INVALID', 'PAN_MISMATCH',
         'DOB_MISMATCH', 'AADHAAR_MISMATCH', 'NAME_MISMATCH', 'SANCTIONS_MATCH', 'NAME_MISMATCH_MINOR', 'DOCUMENT_EXPIRED',
         'ADDRESS_PROOF_STALE', 'ADDRESS_MISMATCH', 'SANCTIONS_POSSIBLE_MATCH', 'PEP_MATCH', 'DUPLICATE_CUSTOMER']

def oracle(app, docs):
    """app: dict; docs: list of dicts {id, declared, classified, tconf, fields{name:(value, conf)}} (classified OTHER/0 when unknown)."""
    on = d(app['application_date'])
    fired = set()
    docs = sorted(docs, key=lambda x: x['id'])
    sel = lambda types: next((x for x in docs if x['classified'] in types), None)
    pan_doc, aad_doc, adr_doc = sel(['PAN_CARD']), sel(['AADHAAR_CARD']), sel(ADDRESS_TYPES)
    usable = lambda doc, f: (doc is not None and f in doc['fields'] and str(doc['fields'][f][0]).strip() != '' and doc['fields'][f][1] >= MIN_CONF)
    val = lambda doc, f: doc['fields'][f][0]
    if any(x is None or x['tconf'] < MIN_CONF for x in (pan_doc, aad_doc, adr_doc)): fired.add('DOCUMENT_MISSING')
    if any(x['classified'] != x['declared'] for x in docs): fired.add('DOCUMENT_TYPE_MISMATCH')
    if any(x['tconf'] < MIN_CONF for x in docs): fired.add('LOW_EXTRACTION_CONFIDENCE')
    for x in (pan_doc, aad_doc, adr_doc):
        if x is None: continue
        for f in REQUIRED[x['classified']]:
            if not usable(x, f): fired.add('LOW_EXTRACTION_CONFIDENCE')
    dob = d(app['dob'])
    if age_on(dob, on) < 18: fired.add('AGE_BELOW_18')
    pan = app['pan_number']
    import re
    if not re.fullmatch(r'[A-Z]{5}[0-9]{4}[A-Z]', pan) or pan[3] != 'P': fired.add('PAN_INVALID')
    if usable(pan_doc, 'pan_number') and val(pan_doc, 'pan_number') != pan: fired.add('PAN_MISMATCH')
    for x in (pan_doc, aad_doc):
        if usable(x, 'dob') and val(x, 'dob') != app['dob']: fired.add('DOB_MISMATCH')
    if usable(aad_doc, 'aadhaar_last4') and val(aad_doc, 'aadhaar_last4') != app['aadhaar_last4']: fired.add('AADHAAR_MISMATCH')
    scores = [sim(app['full_name'], val(x, 'name')) for x in (pan_doc, aad_doc) if usable(x, 'name')]
    score = min(scores) if scores else None
    if score is not None:
        if score < 0.75: fired.add('NAME_MISMATCH')
        elif score < 0.90: fired.add('NAME_MISMATCH_MINOR')
    san = screen(app['full_name'], app['dob'], [dict(name=s[1], alias=s[2], dob=s[3]) for s in SANCTIONS])
    pep = screen(app['full_name'], app['dob'], [dict(name=p[1], alias='', dob=p[2]) for p in PEPS])
    if san == 'MATCH': fired.add('SANCTIONS_MATCH')
    elif san == 'POSSIBLE': fired.add('SANCTIONS_POSSIBLE_MATCH')
    if pep == 'MATCH': fired.add('PEP_MATCH')
    if adr_doc is not None:
        if adr_doc['classified'] == 'DRIVING_LICENCE' and usable(adr_doc, 'valid_until') and d(val(adr_doc, 'valid_until')) < on: fired.add('DOCUMENT_EXPIRED')
        if adr_doc['classified'] in ('ELECTRICITY_BILL', 'BANK_STATEMENT') and usable(adr_doc, 'document_date'):
            delta = (on - d(val(adr_doc, 'document_date'))).days
            if delta > 90 or delta < 0: fired.add('ADDRESS_PROOF_STALE')
        if usable(adr_doc, 'pincode') and val(adr_doc, 'pincode') != app['pincode']: fired.add('ADDRESS_MISMATCH')
    if pan in {e[2] for e in EXISTING}: fired.add('DUPLICATE_CUSTOMER')
    codes = [c for c in CODES if c in fired]
    rejects = set(CODES[3:10])
    decision = 'REJECT' if fired & rejects else ('REVIEW' if fired else 'APPROVE')
    risk = rekyc = ''
    if decision != 'REJECT':
        occ = OCC_RISK.get(app['occupation_code'], 'LOW')
        if 'PEP_MATCH' in fired or 'SANCTIONS_POSSIBLE_MATCH' in fired or occ == 'HIGH': risk = 'HIGH'
        elif occ == 'MEDIUM' or int(app['annual_income']) >= 2500000: risk = 'MEDIUM'
        else: risk = 'LOW'
        rekyc = add_years(on, {'HIGH': 2, 'MEDIUM': 8, 'LOW': 10}[risk]).isoformat()
    return dict(decision=decision, codes='|'.join(codes), score='' if score is None else f'{score:.4f}', risk=risk, rekyc=rekyc)

# ------------------------------------------------------------------------------------------------ document builders
MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
def dmy(iso, style):
    y, m, dd = iso.split('-')
    return f'{dd}/{m}/{y}' if style == 0 else f'{dd}-{MON[int(m) - 1]}-{y}'

def text_of(kind, f, style=0):
    head = 'SYNTHETIC SPECIMEN - NOT A VALID DOCUMENT\n'
    if kind == 'PAN_CARD':
        return head + f"INCOME TAX DEPARTMENT\nPERMANENT ACCOUNT NUMBER CARD\nName: {f['name']}\nDate of Birth: {dmy(f['dob'], style)}\nPAN: {f['pan_number']}\n"
    if kind == 'AADHAAR_CARD':
        return head + f"UNIQUE IDENTIFICATION AUTHORITY (SPECIMEN)\nName: {f['name']}\nDOB: {dmy(f['dob'], style)}\nGender: {f['gender']}\nAadhaar No: XXXX XXXX {f['aadhaar_last4']}\nAddress: {f['address']}\n"
    if kind == 'ELECTRICITY_BILL':
        return head + f"DECCAN STATE ELECTRICITY BOARD - ELECTRICITY BILL\nConsumer Name: {f['name']}\nService Address: {f['address']}\nPincode: {f['pincode']}\nBill Date: {dmy(f['document_date'], 1)}\nAmount Due: Rs 1,284.00\n"
    if kind == 'BANK_STATEMENT':
        return head + f"DECCAN DIGITAL BANK (SPECIMEN) - ACCOUNT STATEMENT\nAccount Holder: {f['name']}\nAddress: {f['address']}\nPincode: {f['pincode']}\nStatement Date: {dmy(f['document_date'], 1)}\nClosing Balance: Rs 48,210.55\n"
    if kind == 'DRIVING_LICENCE':
        return head + f"DRIVING LICENCE (SPECIMEN)\nName: {f['name']}\nDOB: {dmy(f['dob'], style)}\nAddress: {f['address']}\nPincode: {f['pincode']}\nValid Till: {dmy(f['valid_until'], style)}\n"
    return head + 'GROCERY RECEIPT\nItems: rice, lentils, tea\nTotal: Rs 612.00\n'

class Doc:
    def __init__(self, kind, truth, declared=None, classified=None, tconf=0.98, confs=None, over=None, unknown=False, style=0):
        self.kind, self.truth = kind, dict(truth)
        self.declared = declared or kind
        self.classified = 'OTHER' if unknown else (classified or kind)
        self.tconf = 0.0 if unknown else tconf
        self.unknown = unknown
        self.style = style
        self.over = over or {}   # field -> (value as the extractor read it, confidence)
        self.confs = confs or {}
        self.id = None
    def fields(self):
        out = {}
        for k, v in self.truth.items():
            out[k] = (v, self.confs.get(k, 0.96))
        for k, (v, c) in self.over.items():
            if v is None: out.pop(k, None)
            else: out[k] = (v, c)
        return out
    def for_oracle(self):
        return dict(id=self.id, declared=self.declared, classified=self.classified, tconf=self.tconf, fields={} if self.unknown else self.fields())

ADDR = 'Flat 12, Lotus Residency, MG Road, Mumbai'

def triple(p, adr_kind='ELECTRICITY_BILL', adr_days=20, **kw):
    """The three standard documents of an applicant whose printed details equal the declared ones."""
    on = d(p['application_date'])
    pan = Doc('PAN_CARD', dict(name=p['full_name'].upper(), dob=p['dob'], pan_number=p['pan_number']), tconf=0.98, style=kw.get('style', 0))
    aad = Doc('AADHAAR_CARD', dict(name=p['full_name'].upper(), dob=p['dob'], gender=p['gender'], aadhaar_last4=p['aadhaar_last4'], address=p['address'].upper()), tconf=0.97, style=1 - kw.get('style', 0))
    common = dict(name=p['full_name'].upper(), address=p['address'].upper(), pincode=p['pincode'])
    if adr_kind == 'DRIVING_LICENCE':
        adr = Doc(adr_kind, dict(common, dob=p['dob'], valid_until='2030-01-01'), tconf=0.96)
    else:
        adr = Doc(adr_kind, dict(common, document_date=(on - timedelta(days=adr_days)).isoformat()), tconf=0.97)
    return [pan, aad, adr]

FIRST = ['Arjun','Meera','Sanjay','Divya','Imran','Rhea','Kabir','Nisha','Vikram','Tanvi','Omkar','Lakshmi','Farhan','Anita','Rohan','Sneha','Pranav','Zara','Mihir','Charu','Yash','Ira','Dev','Kriti','Aman','Riya','Nikhil','Pallavi','Harsh','Ishita','Tarun','Maya','Gaurav','Ananya','Sameer','Bhavna','Kunal','Esha','Rajat','Simran','Varun','Aditi','Jay','Kiran','Neel','Pari','Uday','Vani','Wasim','Yamini','Zubin','Alka','Bharat','Chitra','Deepak','Evelyn','Girish']
LAST  = ['Reddy','Nair','Kapoor','Joshi','Ansari','Bose','Malhotra','Pillai','Chawla','Sethi','Kulkarni','Menon','Siddiqui','Rao','Desai','Banerjee','Agarwal','Khanna','Patil','Gupta','Mehra','Saxena','Thakur','Iyer','Bhatt','Naidu','Shetty','Das','Mishra','Verma','Pandey','Ghosh','Lal','Rathod','Kohli','Sinha','Dutta','Nayak','Chopra','Sood','Hegde','Kaur','Trivedi','Bajaj','Yadav','Rana','Oberoi','Parekh','Qureshi','Wagle','Zaveri','Ahuja','Basu','Chandra','Dalal','Eapen','Fernandes']

def person(k, **ov):
    f, l = FIRST[k % len(FIRST)], LAST[(k * 7) % len(LAST)]
    p = dict(application_date=APP_DATE.isoformat(), full_name=f'{f} {l}', dob=f'{1975 + (k * 3) % 25}-{1 + k % 12:02d}-{1 + (k * 5) % 27:02d}',
             gender='FEMALE' if k % 2 else 'MALE', pan_number=f'ZZ{f[0]}P{l[0]}{1000 + k * 37:04d}{chr(65 + (k * 3) % 26)}',
             aadhaar_last4=f'{1000 + (k * 811) % 9000:04d}', mobile=f'9{800000000 + k * 7919:09d}', email=f'{f.lower()}.{l.lower()}@example.org',
             address=ADDR, city='Mumbai', state='Maharashtra', pincode='400001', occupation_code='SALARIED_PRIVATE', annual_income='900000')
    p.update(ov)
    if 'email' not in ov:
        import re
        p['email'] = re.sub(r'[^a-z]+', '.', p['full_name'].lower()).strip('.') + '@example.org'
    return p

CASES = []   # (case_id, application dict, docs list, note)
def add(app, docs, note):
    CASES.append((app, docs, note))

# ---- worked examples 1-10 (exactly as described in the case document)
p = person(1, gender='MALE', full_name='Ravi Kumar Sharma', dob='1990-05-15', pan_number='ZZKPS1234Q', aadhaar_last4='4821')
add(p, triple(p), 'Ex1 clean applicant -> APPROVE, LOW, AUTO_APPROVED')
p = person(2, full_name='Kavya Iyer', dob='2008-09-10', occupation_code='STUDENT', pan_number='ZZKPI2468K', aadhaar_last4='3187', gender='FEMALE')
add(p, triple(p), 'Ex2 age 17 -> AGE_BELOW_18')
p = person(3, full_name='Meera Nair', dob='1992-11-02', pan_number='ZZMPN3456S', aadhaar_last4='5902', gender='FEMALE')
dd = triple(p); dd[0].truth['pan_number'] = 'ZZMPN3465S'
add(p, dd, 'Ex3 PAN card shows ZZMPN3465S, declared ZZMPN3456S -> PAN_MISMATCH')
p = person(4, gender='MALE', full_name='Ravi Kumar Sharma', dob='1988-07-21', pan_number='ZZRPS4521L', aadhaar_last4='3344')
dd = triple(p); dd[0].truth['name'] = 'RAVI K SHARMA'
add(p, dd, 'Ex4 PAN card shows Ravi K Sharma -> NAME_MISMATCH_MINOR 0.7647')
p = person(5, full_name='Sanjana Rao', dob='1995-01-30', pan_number='ZZSPR7788E', aadhaar_last4='6150', gender='FEMALE')
add(p, triple(p, adr_days=120), 'Ex5 electricity bill 120 days old -> ADDRESS_PROOF_STALE')
p = person(6, gender='MALE', full_name='Valko Quillon', dob='1986-02-23', pan_number='ZZVPQ4455R', aadhaar_last4='7733')
add(p, triple(p), 'Ex6 equals sanctions entry SAN0002 -> SANCTIONS_MATCH')
p = person(7, full_name='Zoya Menon', dob='1982-10-15', pan_number='ZZZPM3321K', aadhaar_last4='2209', gender='FEMALE')
add(p, triple(p), 'Ex7 equals PEP0001 -> PEP_MATCH, HIGH')
p = person(8, gender='MALE', full_name='Arjun Reddy', dob='1993-08-19', pan_number='ZZAPR6612N', aadhaar_last4='8841')
dd = triple(p)
dd[1] = Doc('BANK_STATEMENT', dict(name=p['full_name'].upper(), address=p['address'].upper(), pincode=p['pincode'], document_date='2026-02-12'), declared='AADHAAR_CARD', tconf=0.97)
add(p, dd, 'Ex8 file declared AADHAAR_CARD is a bank statement -> DOCUMENT_MISSING|DOCUMENT_TYPE_MISMATCH')
p = person(9, full_name='Tanya Sethi', dob='1991-04-09', pan_number='ZZTPS9012Y', aadhaar_last4='4096', gender='FEMALE')
dd = triple(p); dd[0].over['pan_number'] = ('ZZTP59O12Y', 0.62)
add(p, dd, 'Ex9 poor scan, pan_number read as ZZTP59O12Y (0.62) -> LOW_EXTRACTION_CONFIDENCE')
p = person(10, full_name='Fatima Khan', dob='1985-12-12', occupation_code='JEWELLER_BULLION_DEALER', pan_number='ZZFPK7788H', aadhaar_last4='1357', gender='FEMALE')
add(p, triple(p, adr_kind='DRIVING_LICENCE'), 'Ex10 HIGH-risk occupation, driving licence -> APPROVE, PENDING_CHECKER')
N_EXAMPLES = len(CASES)

# ---- further cases: one per rule, boundaries and combinations (expected values come from the oracle)
def build(k, note, adr_kind='ELECTRICITY_BILL', adr_days=20, mut=None, **ov):
    p = person(k, **ov)
    dd = triple(p, adr_kind=adr_kind, adr_days=adr_days)
    if mut: dd = mut(p, dd) or dd
    add(p, dd, note)
    return p, dd

k = 11
build(k, 'Medium-risk occupation -> MEDIUM, +8 years', occupation_code='BUSINESS_OWNER'); k += 1
build(k, 'Income exactly Rs 25,00,000 -> MEDIUM', annual_income='2500000'); k += 1
build(k, 'Income Rs 24,99,999 -> LOW', annual_income='2499999'); k += 1
build(k, 'HIGH-risk occupation with a bank statement -> HIGH, PENDING_CHECKER', occupation_code='REAL_ESTATE_DEALER', adr_kind='BANK_STATEMENT'); k += 1
build(k, 'Exactly 18 on the application date -> passes', dob='2008-03-04'); k += 1
build(k, 'Turns 18 tomorrow (17 today) -> AGE_BELOW_18', dob='2008-03-05'); k += 1
build(k, '29 February application date: LOW +10y -> 28 February', application_date='2028-02-29'); k += 1
build(k, '29 February application date: HIGH +2y -> 28 February', application_date='2028-02-29', occupation_code='MONEY_CHANGER_FOREX'); k += 1
def m(p, dd): dd[0].truth['pan_number'] = p['pan_number']
p0 = person(k)
build(k, 'Declared PAN has company holder type C -> PAN_INVALID', pan_number='ZZ' + p0['pan_number'][2] + 'C' + p0['pan_number'][4:]); k += 1
p0 = person(k)
def m(p, dd): dd[0].truth['pan_number'] = 'ZZ' + p['pan_number'][2:]  # card has a valid PAN, declared one is malformed
build(k, 'Declared PAN malformed -> PAN_INVALID|PAN_MISMATCH', mut=m, pan_number=p0['pan_number'][:9]); k += 1
def m(p, dd): dd[1].truth['dob'] = '1991-01-01'
build(k, 'Aadhaar card shows a different dob -> DOB_MISMATCH', mut=m); k += 1
def m(p, dd): dd[0].truth['dob'] = '1991-01-01'
build(k, 'PAN card shows a different dob -> DOB_MISMATCH', mut=m); k += 1
def m(p, dd): dd[1].truth['aadhaar_last4'] = '0000'
build(k, 'Aadhaar card shows other last four digits -> AADHAAR_MISMATCH', mut=m); k += 1
def m(p, dd): dd[0].truth['name'] = 'SURESH VERMA'; dd[1].truth['name'] = 'SURESH VERMA'
build(k, 'Names on both cards unrelated -> NAME_MISMATCH', mut=m); k += 1
def m(p, dd): dd[0].truth['name'] = 'ANIK ROX'
build(k, 'Similarity exactly 0.75 -> NAME_MISMATCH_MINOR (not a reject)', mut=m, full_name='Anil Roy'); k += 1
def m(p, dd): dd[0].truth['name'] = 'SUNIL BOSA'
build(k, 'Similarity exactly 0.90 -> passes', mut=m, full_name='Sunil Bose'); k += 1
def m(p, dd):
    dd[0].truth['name'] = 'ANITA RAO'; dd[1].truth['name'] = 'ANITA RAO'
build(k, 'Title Dr. is ignored -> 1.0000', mut=m, full_name='Dr. Anita Rao'); k += 1
def m(p, dd):
    dd[0].truth['name'] = 'ANITA RAO KULKARNI'; dd[1].truth['name'] = 'ANITA RAO KULKARNI'
build(k, 'Hyphenated surname and token order ignored -> 1.0000', mut=m, full_name='Kulkarni-Rao Anita'); k += 1
def m(p, dd): dd[1].truth['name'] = 'RAVI K SHARMA'
build(k, 'Lowest of PAN and Aadhaar name scores is used -> 0.7647', mut=m, full_name='Ravi Kumar Sharma'); k += 1
def m(p, dd): dd[0].confs['name'] = 0.70
build(k, 'Name on PAN card unreadable (0.70) -> LOW_EXTRACTION_CONFIDENCE, score from Aadhaar only', mut=m); k += 1
def m(p, dd): dd[0].over['dob'] = ('1999-09-09', 0.55)
build(k, 'Unreadable dob on PAN card (0.55) -> R3 only, R7 not evaluated', mut=m); k += 1
def m(p, dd): dd[2].tconf = 0.75
build(k, 'Address proof doc_type confidence 0.75 -> DOCUMENT_MISSING|LOW_EXTRACTION_CONFIDENCE (assumption A-R1)', mut=m); k += 1
def m(p, dd): dd[2].over['valid_until'] = (None, 0)
build(k, 'Driving licence without valid_until -> LOW_EXTRACTION_CONFIDENCE, R12 not evaluated', mut=m, adr_kind='DRIVING_LICENCE'); k += 1
def m(p, dd): dd[2].classified = 'BANK_STATEMENT'
build(k, 'Bill classified as BANK_STATEMENT (still an address proof) -> DOCUMENT_TYPE_MISMATCH', mut=m); k += 1
def m(p, dd): dd.append(Doc('OTHER', {}, declared='BANK_STATEMENT', classified='OTHER', tconf=0.9))
build(k, 'A fourth, unrelated document declared as a bank statement -> DOCUMENT_TYPE_MISMATCH', mut=m); k += 1
def m(p, dd): del dd[1]
build(k, 'No Aadhaar uploaded -> DOCUMENT_MISSING', mut=m); k += 1
def m(p, dd): del dd[2]
build(k, 'No address proof -> DOCUMENT_MISSING', mut=m); k += 1
def m(p, dd):
    bad = Doc('PAN_CARD', dict(name='SOMEONE ELSE', dob='1970-01-01', pan_number='ZZXPE0001X'), tconf=0.98)
    dd.append(bad)
build(k, 'Two PAN cards: the lowest doc_id is used, the later one is ignored -> APPROVE', mut=m); k += 1
build(k, 'Under 18 and PEP match -> AGE_BELOW_18|PEP_MATCH (reject wins, codes in rule order)', full_name='Zoya Menon', dob='2009-10-15'); k += 1
build(k, 'Declared name equals a sanctions alias, dob equal -> SANCTIONS_MATCH', full_name='O Dravik', dob='1975-04-12'); k += 1
build(k, 'Sanctions entry without dob -> SANCTIONS_MATCH whatever the dob', full_name='Teodor Marchek', dob='1980-06-06'); k += 1
build(k, 'Same name as a sanctions entry, different dob -> SANCTIONS_POSSIBLE_MATCH, HIGH', full_name='Bruno Falkenrath', dob='1990-01-01'); k += 1
build(k, 'Similarity 0.85 to a sanctions entry, equal dob -> SANCTIONS_POSSIBLE_MATCH', full_name='Valka Quillen', dob='1986-02-23'); k += 1
build(k, 'PEP match -> PEP_MATCH, HIGH', full_name='Harish Nambiar', dob='1960-02-11'); k += 1
build(k, 'PEP name with a different dob and similarity >= 0.90 is only POSSIBLE -> no rule fires', full_name='Mandar Kulshreshtha', dob='1970-01-01'); k += 1
build(k, 'PEP match and sanctions possible -> PEP_MATCH|SANCTIONS_POSSIBLE_MATCH order', full_name='Leena Pradhan', dob='1980-01-01'); k += 1
build(k, 'Declared PAN already belongs to a customer -> DUPLICATE_CUSTOMER', pan_number='ZZDPP5555D'); k += 1
def m(p, dd): dd[2].truth['valid_until'] = '2026-03-03'
build(k, 'Driving licence valid until the day before -> DOCUMENT_EXPIRED', mut=m, adr_kind='DRIVING_LICENCE'); k += 1
def m(p, dd): dd[2].truth['valid_until'] = '2026-03-04'
build(k, 'Driving licence valid until the application date -> passes', mut=m, adr_kind='DRIVING_LICENCE'); k += 1
build(k, 'Bill exactly 90 days old -> passes', adr_days=90); k += 1
build(k, 'Bill 91 days old -> ADDRESS_PROOF_STALE', adr_days=91); k += 1
build(k, 'Bank statement dated after the application date -> ADDRESS_PROOF_STALE', adr_days=-1, adr_kind='BANK_STATEMENT'); k += 1
def m(p, dd): dd[2].truth['pincode'] = '560001'
build(k, 'Address proof pincode differs -> ADDRESS_MISMATCH', mut=m); k += 1
def m(p, dd): dd[2].truth['pincode'] = '560001'; dd[2].confs['pincode'] = 0.60
build(k, 'Unreadable pincode (0.60) -> R3 only, R14 not evaluated', mut=m); k += 1
def m(p, dd): dd[0].truth['pan_number'] = 'ZZQPQ0000Q'; dd[1].truth['dob'] = '1960-01-01'; dd[1].truth['aadhaar_last4'] = '0001'
build(k, 'PAN, dob and Aadhaar all differ -> PAN_MISMATCH|DOB_MISMATCH|AADHAAR_MISMATCH', mut=m); k += 1
def m(p, dd): dd[0].truth['pan_number'] = 'ZZQPQ0000Q'
build(k, 'Reject plus review reason -> PAN_MISMATCH|ADDRESS_PROOF_STALE', mut=m, adr_days=100); k += 1
def m(p, dd): dd[0].over['pan_number'] = ('ZZXXXXXX', 0.50)
build(k, 'Poor PAN scan with a HIGH-risk occupation -> LOW_EXTRACTION_CONFIDENCE, HIGH', mut=m, occupation_code='JEWELLER_BULLION_DEALER'); k += 1
build(k, 'Occupation code not in the table -> default risk LOW (assumption A-OCC)', occupation_code='UNLISTED_CODE'); k += 1
def m(p, dd):
    for x in dd: x.unknown = True; x.classified = 'OTHER'; x.tconf = 0.0
build(k, 'No extraction output at all (unknown documents) -> R1|R2|R3, no score', mut=m); k += 1
build(k, 'Clean applicant with a bank statement as address proof -> APPROVE, LOW', adr_kind='BANK_STATEMENT'); k += 1
assert len(CASES) == 60, len(CASES)

# ------------------------------------------------------------------------------------------------ write files
def w_csv(path, header, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', newline='', encoding='utf-8') as fh:
        wr = csv.writer(fh, lineterminator='\n'); wr.writerow(header); wr.writerows(rows)

ref = os.path.join(ROOT, 'reference')
w_csv(f'{ref}/occupations.csv', ['occupation_code', 'description', 'risk_level'], OCCUPATIONS)
w_csv(f'{ref}/sanctions.csv', ['list_id', 'name', 'alias', 'dob', 'nationality', 'program'], SANCTIONS)
w_csv(f'{ref}/pep.csv', ['pep_id', 'name', 'dob', 'position', 'category'], PEPS)
w_csv(f'{ref}/existing_customers.csv', ['customer_id', 'full_name', 'pan_number', 'dob'], EXISTING)
with open(f'{ref}/rules_config.json', 'w') as fh: json.dump(RULES_CONFIG, fh, indent=2); fh.write('\n')

APP_COLS = ['application_id', 'application_date', 'full_name', 'dob', 'gender', 'pan_number', 'aadhaar_last4', 'mobile', 'email', 'address',
            'city', 'state', 'pincode', 'occupation_code', 'annual_income']
EXP_COLS = ['expected_decision', 'expected_reason_codes', 'expected_name_match_score', 'expected_risk_category', 'expected_rekyc_due_date']
apps_rows, doc_rows, ext_rows, text_rows, notes = [], [], [], [], []
doc_no = 0
for i, (app, docs, note) in enumerate(CASES, 1):
    app['application_id'] = f'A{2000000 + i}'
    for dc in docs:
        doc_no += 1
        dc.id = f'D{3000000 + doc_no}'
    exp = oracle(app, [x.for_oracle() for x in docs])
    app['_exp'] = exp
    apps_rows.append([app[c] for c in APP_COLS] + [exp['decision'], exp['codes'], exp['score'], exp['risk'], exp['rekyc']])
    notes.append((app['application_id'], note))
    for dc in docs:
        doc_rows.append([dc.id, app['application_id'], f'{dc.id}.txt', dc.declared])
        text_rows.append(dict(doc_id=dc.id, application_id=app['application_id'], file_name=f'{dc.id}.txt',
                              text=text_of('OTHER' if dc.kind == 'OTHER' else dc.kind, dc.truth if dc.kind != 'OTHER' else {}, dc.style)))
        if dc.unknown: continue
        ext_rows.append([dc.id, 'doc_type', dc.classified, f'{dc.tconf:.2f}'])
        for f, (v, c) in dc.fields().items():
            ext_rows.append([dc.id, f, v, f'{c:.2f}'])

# Corrected PAN and Aadhaar card for worked example 4 (used by the resubmission demo; they belong to no sample application)
ext_rows += [['D9000001', 'doc_type', 'PAN_CARD', '0.98'], ['D9000001', 'name', 'RAVI KUMAR SHARMA', '0.97'], ['D9000001', 'dob', '1988-07-21', '0.97'], ['D9000001', 'pan_number', 'ZZRPS4521L', '0.97'],
             ['D9000002', 'doc_type', 'AADHAAR_CARD', '0.97'], ['D9000002', 'name', 'RAVI KUMAR SHARMA', '0.96'], ['D9000002', 'dob', '1988-07-21', '0.96'], ['D9000002', 'gender', 'MALE', '0.96'], ['D9000002', 'aadhaar_last4', '3344', '0.96']]

sample = os.path.join(ROOT, 'sample')
w_csv(f'{sample}/applications.csv', APP_COLS + EXP_COLS, apps_rows)
w_csv(f'{sample}/documents.csv', ['doc_id', 'application_id', 'file_name', 'declared_doc_type'], doc_rows)
w_csv(f'{sample}/extraction_mock.csv', ['doc_id', 'field_name', 'value', 'confidence'], ext_rows)
with open(f'{sample}/document_text.jsonl', 'w', encoding='utf-8') as fh:
    for t in text_rows: fh.write(json.dumps(t) + '\n')
w_csv(f'{sample}/case_notes.csv', ['application_id', 'what_it_tests'], notes)

# ---- the case document's own expected results for examples 1-10 (typed in by hand from Section 6.4)
EXPECT = {
    1: ('APPROVE', '', '1.0000', 'LOW', '2036-03-04'),
    2: ('REJECT', 'AGE_BELOW_18', '1.0000', '', ''),
    3: ('REJECT', 'PAN_MISMATCH', None, '', ''),
    4: ('REVIEW', 'NAME_MISMATCH_MINOR', '0.7647', 'LOW', '2036-03-04'),
    5: ('REVIEW', 'ADDRESS_PROOF_STALE', '1.0000', 'LOW', None),
    6: ('REJECT', 'SANCTIONS_MATCH', None, '', ''),
    7: ('REVIEW', 'PEP_MATCH', None, 'HIGH', '2028-03-04'),
    8: ('REVIEW', 'DOCUMENT_MISSING|DOCUMENT_TYPE_MISMATCH', '1.0000', 'LOW', None),
    9: ('REVIEW', 'LOW_EXTRACTION_CONFIDENCE', None, None, None),
    10: ('APPROVE', '', None, 'HIGH', '2028-03-04'),
}
for n, exp in EXPECT.items():
    got = CASES[n - 1][0]['_exp']
    for have, want, label in zip((got['decision'], got['codes'], got['score'], got['risk'], got['rekyc']), exp, ('decision', 'codes', 'score', 'risk', 'rekyc')):
        if want is not None and have != want:
            sys.exit(f'Example {n}: {label} is "{have}" but the case document says "{want}"')

# ---- worked examples folder (documents to upload + the form values to type)
we = os.path.join(ROOT, 'worked_examples')
shutil.rmtree(we, ignore_errors=True)
TITLE = {1: 'clean applicant', 2: 'under 18', 3: 'PAN mismatch', 4: 'name differs slightly', 5: 'stale electricity bill', 6: 'sanctions match',
         7: 'PEP match', 8: 'wrong document type', 9: 'poor scan of the PAN card', 10: 'high-risk occupation'}
RESULT = {1: 'APPROVE, no reason codes, score 1.0000, risk LOW, re-KYC 2036-03-04. Status AUTO_APPROVED.',
          2: 'REJECT, AGE_BELOW_18, score 1.0000, risk and re-KYC empty. Status AUTO_REJECTED.',
          3: 'REJECT, PAN_MISMATCH. Status AUTO_REJECTED.',
          4: 'REVIEW, NAME_MISMATCH_MINOR, score 0.7647, risk LOW, re-KYC 2036-03-04. Status IN_REVIEW.',
          5: 'REVIEW, ADDRESS_PROOF_STALE, score 1.0000, risk LOW. Status IN_REVIEW.',
          6: 'REJECT, SANCTIONS_MATCH (entry SAN0002). Status AUTO_REJECTED.',
          7: 'REVIEW, PEP_MATCH (entry PEP0001), risk HIGH, re-KYC 2028-03-04. Status IN_REVIEW.',
          8: 'REVIEW, DOCUMENT_MISSING|DOCUMENT_TYPE_MISMATCH, score 1.0000 (PAN only), risk LOW. Status IN_REVIEW.',
          9: 'REVIEW, LOW_EXTRACTION_CONFIDENCE. PAN_MISMATCH is NOT evaluated because the pan_number field is not usable (0.62). Status IN_REVIEW.',
          10: 'APPROVE, no reason codes, risk HIGH, re-KYC 2028-03-04. Status PENDING_CHECKER (a HIGH-risk approval needs the checker).'}
FORM = ['full_name', 'dob', 'gender', 'pan_number', 'aadhaar_last4', 'mobile', 'email', 'address', 'city', 'state', 'pincode', 'occupation_code', 'annual_income']
for n in range(1, 11):
    app, docs, note = CASES[n - 1]
    folder = os.path.join(we, f'ex{n:02d}-{TITLE[n].replace(" ", "-")}')
    os.makedirs(folder)
    for t in text_rows:
        if t['application_id'] == app['application_id']:
            with open(os.path.join(folder, t['file_name']), 'w', encoding='utf-8', newline='\n') as fh: fh.write(t['text'])
    lines = [f'# Worked example {n}: {TITLE[n]}', '',
             f'Sample application **{app["application_id"]}**. Run the app with `APPLICATION_DATE=2026-03-04` (see `.env.example`) so it is dated like the case document.', '',
             '## Form values', '']
    lines += [f'- {f}: `{app[f]}`' for f in FORM]
    lines += ['', '## Upload (declared type for each file)', '']
    for dc in docs:
        lines.append(f'- `{dc.id}.txt` as `{dc.declared}`')
    lines += ['', '## Expected result (case document, Section 6.4)', '', RESULT[n], '']
    with open(os.path.join(folder, 'README.md'), 'w') as fh: fh.write('\n'.join(lines))
for n, title, text in [(11, 'maker and checker must differ', 'Take example 4. Officer U1 (a user who works the review queue) recommends APPROVE with a comment of at least 10 characters. U1 then tries to decide the same case as checker: **HTTP 403**. A different Compliance Officer U2 approves: status **APPROVED** and the mock core-banking API returns a customer ID and an account number.'),
                       (12, 'officer corrects the PAN of example 9', 'Open example 9 in the review queue and correct `pan_number` on document `D3000025` to `ZZTPS9012Y` with a reason. The rules re-run: **APPROVE, no reason codes**; the status becomes **PENDING_CHECKER** (a reviewed case still goes to the checker); the audit trail records the old value `ZZTP59O12Y` and the new value.')]:
    folder = os.path.join(we, f'ex{n}-{title.replace(" ", "-")}')
    os.makedirs(folder)
    with open(os.path.join(folder, 'README.md'), 'w') as fh: fh.write(f'# Worked example {n}: {title}\n\n{text}\n')

print(f'{len(CASES)} applications, {len(doc_rows)} documents, {len(ext_rows)} extraction rows')
from collections import Counter
print(Counter(c[0]['_exp']['decision'] for c in CASES))
