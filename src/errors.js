export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function requireValue(condition, status, message) {
  if (!condition) throw new HttpError(status, message);
}
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.name === 'ZodError') return res.status(400).json({message: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')});
  if (error.code === 11000) return res.status(409).json({message: 'This time slot or record is already reserved. Please choose another.'});
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(400).json({message: 'Image must be smaller than 5 MB.'});
  const status = error.status || 500;
  if (status >= 500) console.error('Request failed', {method: req.method, path: req.path, type: error.name});
  res.status(status).json({message: status >= 500 ? 'Something went wrong. Please try again.' : error.message});
}
