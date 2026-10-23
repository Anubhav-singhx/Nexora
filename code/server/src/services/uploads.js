import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config.js';
import { DOC_TYPE_LIST } from '../constants.js';
import { AppError, badRequest, conflict } from '../utils/errors.js';

const DOC_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ALLOWED_MIME = new Set(['text/plain', 'application/octet-stream', '']);

/**
 * Multer parses multipart bodies into memory (max 1 MB per file, max 10 files). Nothing is written to disk
 * until every file has passed validation. Only .txt files are accepted.
 */
export const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxFileBytes,
    files: config.upload.maxDocuments,
    fields: 40,
    fieldSize: 10 * 1024,
  },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext !== '.txt' || !ALLOWED_MIME.has((file.mimetype || '').toLowerCase())) {
      return cb(
        badRequest('UNSUPPORTED_FILE_TYPE', `"${safeName(file.originalname)}" is not allowed. Only .txt files can be uploaded`),
      );
    }
    cb(null, true);
  },
}).array('documents', config.upload.maxDocuments);

const toArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Strips path parts and control characters so a hostile filename can never be echoed or stored raw. */
function safeName(name) {
  return path.basename(String(name || 'file')).replace(/[^\w.\- ]/g, '_').slice(0, 120);
}

function checkTextBuffer(buf) {
  if (buf.length === 0) return 'The file is empty';
  if (buf.includes(0)) return 'The file is not a text file (binary content found)';
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return 'The file is not valid UTF-8 text';
  }
  return null;
}

/**
 * Turns req.files + req.body into validated document records (still in memory).
 * Throws one error that lists every problem, so the user can fix everything in one go.
 * Expected multipart layout: documents (files), document_types (one per file, same order),
 * doc_ids (optional, one per file, same order; defaults to the file name without ".txt").
 */
export function prepareDocuments(req, { minDocuments = config.upload.minDocuments } = {}) {
  const files = req.files || [];
  const types = toArray(req.body?.document_types ?? req.body?.declared_doc_types).map((t) => String(t).trim().toUpperCase());
  const idOverrides = toArray(req.body?.doc_ids).map((t) => String(t).trim());

  if (files.length < minDocuments) {
    throw badRequest(
      'TOO_FEW_DOCUMENTS',
      minDocuments >= 3
        ? `At least ${minDocuments} documents are required (PAN, Aadhaar and an address proof). You sent ${files.length}`
        : `Upload at least ${minDocuments} replacement document. You sent ${files.length}`,
    );
  }
  if (types.length !== files.length) {
    throw badRequest(
      'VALIDATION_ERROR',
      `Send one document_types entry per file (${files.length} files, ${types.length} types)`,
    );
  }
  if (idOverrides.length && idOverrides.length !== files.length) {
    throw badRequest('VALIDATION_ERROR', 'If doc_ids is sent, it must have one entry per file');
  }

  const problems = [];
  const docs = [];
  const seenHashes = new Map();
  const seenDocIds = new Map();

  files.forEach((file, i) => {
    const field = `documents[${i}]`;
    const name = safeName(file.originalname);
    const declaredType = types[i];
    const baseName = path.basename(file.originalname || '', path.extname(file.originalname || ''));
    const docId = idOverrides[i] || baseName;

    if (!DOC_TYPE_LIST.includes(declaredType)) {
      problems.push({ field, message: `"${name}": document type must be one of ${DOC_TYPE_LIST.join(', ')}` });
    }
    if (!DOC_ID_RE.test(docId)) {
      problems.push({
        field,
        message: `"${name}": document id "${safeName(docId)}" is invalid. Use letters, digits, "_" or "-" (rename the file or send doc_ids)`,
      });
    }
    const contentProblem = checkTextBuffer(file.buffer);
    if (contentProblem) problems.push({ field, message: `"${name}": ${contentProblem}` });

    const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
    docs.push({ buffer: file.buffer, originalName: name, declaredType, docId, sha256, size: file.buffer.length });

    seenHashes.set(sha256, [...(seenHashes.get(sha256) || []), name]);
    seenDocIds.set(docId, [...(seenDocIds.get(docId) || []), name]);
  });

  if (problems.length) {
    throw new AppError(400, 'INVALID_DOCUMENT', 'One or more documents were rejected', problems);
  }

  const dupContent = [...seenHashes.values()].find((names) => names.length > 1);
  if (dupContent) {
    throw conflict('DUPLICATE_DOCUMENT', `The same file was uploaded more than once: ${dupContent.join(', ')}`);
  }
  const dupId = [...seenDocIds.entries()].find(([, names]) => names.length > 1);
  if (dupId) {
    throw conflict('DUPLICATE_DOCUMENT_ID', `Document id "${dupId[0]}" is used by more than one file`);
  }
  return docs;
}

/** Writes each buffer to UPLOAD_DIR under a random name. Returns the same docs with storagePath set. */
export async function storeFiles(docs) {
  await fs.mkdir(config.uploadDir, { recursive: true });
  const written = [];
  try {
    for (const d of docs) {
      const storagePath = `${crypto.randomUUID()}.txt`;
      await fs.writeFile(path.join(config.uploadDir, storagePath), d.buffer, { flag: 'wx', mode: 0o600 });
      written.push({ ...d, storagePath });
    }
    return written;
  } catch (err) {
    await removeFiles(written);
    throw err;
  }
}

export async function removeFiles(docs) {
  await Promise.all(
    docs.map((d) => fs.rm(path.join(config.uploadDir, path.basename(d.storagePath)), { force: true }).catch(() => {})),
  );
}

/** Reads a stored file and verifies its SHA-256 still matches what was recorded at upload. */
export async function readStoredText(storagePath, expectedSha256) {
  const full = path.join(config.uploadDir, path.basename(storagePath)); // basename: no path traversal
  let buf;
  try {
    buf = await fs.readFile(full);
  } catch {
    throw new AppError(404, 'FILE_MISSING', 'The stored file could not be found');
  }
  const actual = crypto.createHash('sha256').update(buf).digest('hex');
  if (actual !== expectedSha256) {
    throw new AppError(500, 'INTEGRITY_ERROR', 'Stored document failed its integrity check');
  }
  return buf.toString('utf8');
}
