import { z } from 'zod';
import { validationError } from '../utils/errors.js';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .max(254, 'Email is too long')
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address');

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters'),
  email,
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters') // bcrypt only uses the first 72 bytes
    .regex(/[A-Za-z]/, 'Password must contain a letter')
    .regex(/[0-9]/, 'Password must contain a digit'),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(200),
});

/** Parses `data` with `schema`; throws a 400 VALIDATION_ERROR listing every problem field. */
export function parseOrThrow(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  throw validationError(
    result.error.issues.map((i) => ({ field: i.path.join('.') || '(body)', message: i.message })),
  );
}
