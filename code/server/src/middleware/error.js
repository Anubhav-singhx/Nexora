import multer from 'multer';
import { AppError } from '../utils/errors.js';
import { config } from '../config.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }

  if (err instanceof multer.MulterError) {
    const map = {
      LIMIT_FILE_SIZE: [413, 'FILE_TOO_LARGE', `Each file must be ${config.upload.maxFileBytes / 1024 / 1024} MB or smaller`],
      LIMIT_FILE_COUNT: [400, 'TOO_MANY_DOCUMENTS', `At most ${config.upload.maxDocuments} documents can be uploaded`],
      LIMIT_UNEXPECTED_FILE: [400, 'UNEXPECTED_FILE_FIELD', 'Files must be sent in the "documents" field'],
      LIMIT_FIELD_COUNT: [400, 'BAD_REQUEST', 'Too many form fields'],
      LIMIT_FIELD_VALUE: [400, 'BAD_REQUEST', 'A form field is too long'],
    };
    const [status, code, message] = map[err.code] || [400, 'UPLOAD_ERROR', err.message];
    return res.status(status).json({ error: { code, message } });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
  }

  // PostgreSQL: unique_violation
  if (err.code === '23505') {
    return res.status(409).json({ error: { code: 'DUPLICATE', message: 'This record already exists' } });
  }

  console.error('[error]', req.method, req.originalUrl, err);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server' } });
}
