// Every error response in the API has this shape (locked in contract.md):
//   { "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [ ... optional ... ] } }

export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const validationError = (details, message = 'Some fields are invalid') =>
  new AppError(400, 'VALIDATION_ERROR', message, details);
export const badRequest = (code, message, details) => new AppError(400, code, message, details);
export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to do this') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (code, message, details) => new AppError(409, code, message, details);
export const notImplemented = (owner) =>
  new AppError(501, 'NOT_IMPLEMENTED', `This endpoint is not built yet (owner: ${owner}).`);

/** Express 4/5-safe wrapper so async handlers always forward rejections to the error middleware. */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
