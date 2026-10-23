import { z } from 'zod';
import { businessDate } from '../utils/clock.js';
import { parseOrThrow } from './auth.js';

// Field names follow the case data dictionary. `pan` and `occupation` are accepted as older spellings of
// pan_number and occupation_code.
export const APPLICATION_FIELDS = [
  'full_name',
  'dob',
  'gender',
  'pan_number',
  'aadhaar_last4',
  'mobile',
  'email',
  'address',
  'city',
  'state',
  'pincode',
  'occupation_code',
  'annual_income',
  'consent',
];
const ALIAS = { pan_number: 'pan', occupation_code: 'occupation' };
export const GENDERS = ['MALE', 'FEMALE', 'OTHER'];

/** 'YYYY-MM-DD' -> { ok, future } ; never throws on malformed input. */
function checkDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return { ok: false };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const real = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  if (!real) return { ok: false };
  const today = businessDate(); // calendar dates are compared in IST
  return { ok: true, future: value > today, tooOld: y < 1900 };
}

// NOTE: age < 18 and "4th PAN character is not P" are business rules R4/R5 (Person 2's engine).
// The API only rejects malformed input, so those cases still reach the engine and get a proper REJECT.
export const applicationSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, 'Full name must be at least 2 characters')
    .max(100, 'Full name must be at most 100 characters')
    .regex(/^[\p{L}][\p{L} .'-]*$/u, 'Full name may contain only letters, spaces, dots, hyphens and apostrophes'),
  dob: z
    .string()
    .trim()
    .superRefine((v, ctx) => {
      const c = checkDate(v);
      if (!c.ok) ctx.addIssue({ code: 'custom', message: 'Date of birth must be a real date in YYYY-MM-DD format' });
      else if (c.future) ctx.addIssue({ code: 'custom', message: 'Date of birth cannot be in the future' });
      else if (c.tooOld) ctx.addIssue({ code: 'custom', message: 'Date of birth is not plausible' });
    }),
  gender: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => ({ M: 'MALE', F: 'FEMALE', O: 'OTHER' })[v] || v)
    .refine((v) => GENDERS.includes(v), 'Gender must be MALE, FEMALE or OTHER'),
  pan_number: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN must be 10 characters in the format ABCDE1234F'),
  aadhaar_last4: z
    .string()
    .trim()
    .superRefine((v, ctx) => {
      if (/^\d{12}$/.test(v)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Do not enter the full Aadhaar number. Enter only the last 4 digits',
        });
      } else if (!/^\d{4}$/.test(v)) {
        ctx.addIssue({ code: 'custom', message: 'Aadhaar last 4 must be exactly 4 digits' });
      }
    }),
  email: z.string().trim().toLowerCase().max(120, 'Email must be at most 120 characters').email('Enter a valid email address'),
  address: z
    .string()
    .trim()
    .min(10, 'Address must be at least 10 characters')
    .max(300, 'Address must be at most 300 characters'),
  city: z.string().trim().min(2, 'City is required').max(60, 'City must be at most 60 characters'),
  state: z.string().trim().min(2, 'State is required').max(60, 'State must be at most 60 characters'),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Pincode must be 6 digits and cannot start with 0'),
  mobile: z.string().trim().regex(/^[6-9][0-9]{9}$/, 'Mobile must be 10 digits starting with 6, 7, 8 or 9'),
  occupation_code: z
    .string()
    .trim()
    .min(2, 'Occupation is required')
    .max(80, 'Occupation must be at most 80 characters'),
  annual_income: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Annual income must be a non-negative number')
    .transform(Number),
  consent: z
    .union([z.boolean(), z.string()])
    .refine((v) => v === true || v === 'true', 'KYC consent is mandatory to submit an application')
    .transform(() => true),
});

/** Validates the multipart text fields. Missing fields are treated as empty so they get a clear message. */
export function parseApplicationFields(body) {
  const input = {};
  for (const f of APPLICATION_FIELDS) {
    const v = body?.[f] ?? (ALIAS[f] ? body?.[ALIAS[f]] : undefined);
    input[f] = v === undefined || v === null ? '' : Array.isArray(v) ? String(v[0]) : v;
  }
  return parseOrThrow(applicationSchema, input);
}
