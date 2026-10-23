import { z } from 'zod';
import { CHECKER_DECISION, MAKER_RECOMMENDATION } from '../constants.js';
import { parseDate } from '../utils/dates.js';

const version = z.coerce.number({ invalid_type_error: 'version must be a number' }).int().positive('version is required (send the version you loaded)');

export const correctionSchema = z.object({
  value: z.string().trim().min(1, 'A value is required').max(200),
  reason: z.string().trim().min(5, 'Give a short reason (at least 5 characters)').max(300),
  version,
});

export const recommendSchema = z.object({
  recommendation: z.enum(Object.values(MAKER_RECOMMENDATION), { message: 'recommendation must be APPROVE, REJECT or REQUEST_RESUBMISSION' }),
  comment: z.string().trim().min(10, 'Comment must be at least 10 characters').max(1000),
  version,
});

export const decisionSchema = z
  .object({
    decision: z.enum(Object.values(CHECKER_DECISION), { message: 'decision must be APPROVE, REJECT or SEND_BACK' }),
    comment: z.string().trim().max(1000).optional().default(''),
    version,
  })
  .superRefine((v, ctx) => {
    const needsComment = v.decision !== 'APPROVE';
    if ((needsComment || v.comment) && v.comment.length < 10) {
      ctx.addIssue({ code: 'custom', path: ['comment'], message: 'Comment must be at least 10 characters' });
    }
  });

const isoDate = z.string().trim().refine((v) => parseDate(v) === v, 'Use a real date as YYYY-MM-DD');
const aliases = z.array(z.string().trim().min(1).max(120)).max(20).default([]);

export const sanctionsEntrySchema = z.object({
  list_id: z.string().trim().max(40).optional(),
  name: z.string().trim().min(2).max(160),
  aliases,
  dob: isoDate.nullable().optional(),
  nationality: z.string().trim().max(60).nullable().optional(),
  program: z.string().trim().max(80).nullable().optional(),
});
export const pepEntrySchema = z.object({
  pep_id: z.string().trim().max(40).optional(),
  name: z.string().trim().min(2).max(160),
  aliases,
  dob: isoDate.nullable().optional(),
  position: z.string().trim().max(120).nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
});

export const dateRangeSchema = z
  .object({ from: isoDate.optional(), to: isoDate.optional() })
  .superRefine((v, ctx) => {
    if (v.from && v.to && v.from > v.to) ctx.addIssue({ code: 'custom', path: ['from'], message: '"from" must not be after "to"' });
  });
