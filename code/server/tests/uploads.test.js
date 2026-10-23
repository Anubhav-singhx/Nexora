import fs from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { pool } from '../src/db/index.js';
import { registerApplicant, submitApplication, validDocs } from './helpers.js';

afterAll(() => pool.end());

const countApps = async (userId) =>
  (await pool.query('SELECT count(*)::int AS n FROM applications WHERE user_id = $1', [userId])).rows[0].n;
const filesOnDisk = () => fs.readdirSync(config.uploadDir).length;

/** Replace the first doc with `bad` and keep the other two valid. */
const withBad = (bad) => [bad, ...validDocs().slice(1)];

describe('upload validation (nothing may be saved when a document is rejected)', () => {
  it('requires at least 3 documents', async () => {
    const { token, user } = await registerApplicant();
    const res = await submitApplication(token, { docs: validDocs().slice(0, 2) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TOO_FEW_DOCUMENTS');
    expect(await countApps(user.id)).toBe(0);
  });

  it('rejects an unknown declared document type', async () => {
    const { token } = await registerApplicant();
    const res = await submitApplication(token, { rawTypes: ['PAN_CARD', 'AADHAAR_CARD', 'PASSPORT_PHOTO'] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_DOCUMENT');
    expect(JSON.stringify(res.body.error.details)).toContain('document type must be one of');
  });

  it('rejects a mismatched number of document_types', async () => {
    const { token } = await registerApplicant();
    const res = await submitApplication(token, { rawTypes: ['PAN_CARD', 'AADHAAR_CARD'] });
    expect(res.status).toBe(400);
  });

  it.each([
    ['a .pdf file', 'scan.pdf', 'application/pdf', Buffer.from('%PDF-1.4 fake')],
    ['an .exe renamed with a non-text mime type', 'run.txt', 'application/x-msdownload', Buffer.from('MZ')],
    ['an image', 'photo.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ['a .txt.exe double extension', 'pan.txt.exe', 'text/plain', Buffer.from('hello')],
  ])('rejects %s with UNSUPPORTED_FILE_TYPE', async (_label, name, contentType, buffer) => {
    const { token, user } = await registerApplicant();
    const before = filesOnDisk();
    const res = await submitApplication(token, { docs: withBad({ name, type: 'PAN_CARD', buffer, contentType }) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(await countApps(user.id)).toBe(0);
    expect(filesOnDisk()).toBe(before);
  });

  it('rejects a .txt file containing binary (NUL) bytes', async () => {
    const { token } = await registerApplicant();
    const res = await submitApplication(token, {
      docs: withBad({ name: 'BIN.txt', type: 'PAN_CARD', buffer: Buffer.from([0x41, 0x00, 0x42, 0x00]) }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_DOCUMENT');
    expect(JSON.stringify(res.body.error.details)).toContain('binary');
  });

  it('rejects a .txt file that is not valid UTF-8', async () => {
    const { token } = await registerApplicant();
    const res = await submitApplication(token, {
      docs: withBad({ name: 'LATIN1.txt', type: 'PAN_CARD', buffer: Buffer.from([0x41, 0xff, 0xfe, 0xfd, 0x42]) }),
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error.details)).toContain('UTF-8');
  });

  it('rejects an empty file', async () => {
    const { token } = await registerApplicant();
    const res = await submitApplication(token, { docs: withBad({ name: 'EMPTY.txt', type: 'PAN_CARD', buffer: Buffer.alloc(0) }) });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error.details)).toContain('empty');
  });

  it('rejects a file larger than 1 MB with 413 FILE_TOO_LARGE', async () => {
    const { token, user } = await registerApplicant();
    const big = Buffer.alloc(1024 * 1024 + 1, 'a');
    const before = filesOnDisk();
    const res = await submitApplication(token, { docs: withBad({ name: 'BIG.txt', type: 'PAN_CARD', buffer: big }) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(await countApps(user.id)).toBe(0);
    expect(filesOnDisk()).toBe(before);
  });

  it('accepts a file of exactly 1 MB', async () => {
    const { token } = await registerApplicant();
    const exact = Buffer.alloc(1024 * 1024, 'a');
    const res = await submitApplication(token, { docs: withBad({ name: 'EXACT.txt', type: 'PAN_CARD', buffer: exact }) });
    expect(res.status).toBe(201);
  });

  it('rejects more than 10 documents', async () => {
    const { token } = await registerApplicant();
    const docs = Array.from({ length: 11 }, (_, i) => ({ name: `DOC${i}.txt`, type: 'PAN_CARD', buffer: Buffer.from(`doc ${i}`) }));
    const res = await submitApplication(token, { docs });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TOO_MANY_DOCUMENTS');
  });

  it('rejects an invalid document id (e.g. spaces or path characters in the file name)', async () => {
    const { token } = await registerApplicant();
    const res = await submitApplication(token, {
      docs: withBad({ name: 'my pan card.txt', type: 'PAN_CARD', buffer: validDocs()[0].buffer }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_DOCUMENT');
    const traversal = await submitApplication(token, { docIds: ['../../etc/passwd', 'A1', 'A2'] });
    expect(traversal.status).toBe(400);
  });
});

describe('duplicates (same application)', () => {
  it('rejects the same file content uploaded twice with 409 DUPLICATE_DOCUMENT and saves nothing', async () => {
    const { token, user } = await registerApplicant();
    const [pan, aadhaar, bill] = validDocs();
    const before = filesOnDisk();
    const res = await submitApplication(token, { docs: [pan, aadhaar, bill, { ...pan, name: 'PAN_COPY.txt' }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_DOCUMENT');
    expect(await countApps(user.id)).toBe(0);
    expect(filesOnDisk()).toBe(before);
  });

  it('rejects two files that use the same document id', async () => {
    const { token } = await registerApplicant();
    const res = await submitApplication(token, { docIds: ['D1', 'D1', 'D3'] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_DOCUMENT_ID');
  });

  it('allows the same file in two different applications (the rule is per application)', async () => {
    const a = await registerApplicant();
    const b = await registerApplicant();
    expect((await submitApplication(a.token)).status).toBe(201);
    expect((await submitApplication(b.token)).status).toBe(201);
  });

  it('the database itself also refuses a duplicate hash for one application', async () => {
    const { token } = await registerApplicant();
    const app = (await submitApplication(token)).body.application;
    await expect(
      pool.query(
        `INSERT INTO documents (application_id, doc_id, declared_type, original_filename, sha256, size_bytes, storage_path)
         SELECT application_id, 'OTHERID', declared_type, original_filename, sha256, size_bytes, 'x.txt'
         FROM documents WHERE application_id = $1 LIMIT 1`,
        [app.id],
      ),
    ).rejects.toThrow(/duplicate key/);
  });
});
