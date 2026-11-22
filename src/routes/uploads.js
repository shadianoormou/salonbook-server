import { Router } from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { requireValue } from '../errors.js';
export function uploadRoutes({ guards, config }) {
  const router = Router();
  router.use(
    guards.authenticate,
    rateLimit({ windowMs: 60000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });
  router.post('/', upload.single('image'), async (req, res) => {
    requireValue(
      config.IMGBB_API_KEY,
      503,
      'Image upload is being configured. Please try again later.',
    );
    const file = req.file;
    requireValue(file, 400, 'Please choose an image.');
    const b = file.buffer;
    const valid =
      (file.mimetype === 'image/jpeg' && b[0] === 255 && b[1] === 216 && b[2] === 255) ||
      (file.mimetype === 'image/png' &&
        b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (file.mimetype === 'image/webp' &&
        b.subarray(0, 4).toString() === 'RIFF' &&
        b.subarray(8, 12).toString() === 'WEBP');
    requireValue(valid, 400, 'Choose a valid JPG, PNG, or WebP image.');
    const form = new URLSearchParams({ image: b.toString('base64') });
    const response = await fetch(
      `https://api.imgbb.com/1/upload?key=${encodeURIComponent(config.IMGBB_API_KEY)}`,
      { method: 'POST', body: form, signal: AbortSignal.timeout(30000) },
    );
    const result = await response.json();
    requireValue(
      response.ok && result.success && result.data?.url,
      502,
      'Image upload failed. Please try again.',
    );
    res.status(201).json({ url: result.data.url });
  });
  return router;
}
