import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { toNodeHandler } from 'better-auth/node';
import { errorHandler, HttpError } from './errors.js';
import { serviceRoutes, adminServiceRoutes } from './routes/services.js';
import { appointmentRoutes, adminAppointmentRoutes } from './routes/appointments.js';
import { profileRoutes, userRoutes } from './routes/users.js';
import { overviewRoutes, transactionRoutes } from './routes/overview.js';
import { paymentRoutes, stripeWebhook } from './routes/payments.js';
import { uploadRoutes } from './routes/uploads.js';

export function createApp(context) {
  const { config, auth } = context,
    app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: config.CLIENT_URL,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  );
  app.post(
    '/api/payments/webhook',
    express.raw({ type: 'application/json', limit: '1mb' }),
    stripeWebhook(context),
  );
  app.use(
    '/api/auth',
    rateLimit({ windowMs: 60000, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  app.all('/api/auth/*splat', toNodeHandler(auth));
  app.use(express.json({ limit: '100kb' }));
  app.use(
    '/api',
    rateLimit({ windowMs: 60000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  app.use('/api', (req, res, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== config.CLIENT_URL
    )
      throw new HttpError(403, 'Untrusted request origin.');
    next();
  });
  app.get('/api/health', async (req, res) => {
    await context.db.command({ ping: 1 });
    res.json({ status: 'ok', service: 'SalonBook API' });
  });
  app.get('/api/config', (req, res) =>
    res.json({
      googleEnabled: !!config.GOOGLE_CLIENT_ID,
      uploadsEnabled: !!config.IMGBB_API_KEY,
      paymentsEnabled: !!config.STRIPE_SECRET_KEY,
      timeZone: config.SALON_TIMEZONE,
      currency: config.STRIPE_CURRENCY,
    }),
  );
  app.use('/api/services', serviceRoutes(context));
  app.use('/api/appointments', appointmentRoutes(context));
  app.use('/api/profile', profileRoutes(context));
  app.use('/api/overview', overviewRoutes(context));
  app.use('/api/transactions', transactionRoutes(context));
  app.use('/api/payments', paymentRoutes(context));
  app.use('/api/uploads', uploadRoutes(context));
  app.use('/api/admin/services', adminServiceRoutes(context));
  app.use('/api/admin/appointments', adminAppointmentRoutes(context));
  app.use('/api/admin/users', userRoutes(context));
  app.use((req, res) => res.status(404).json({ message: 'This API route does not exist.' }));
  app.use(errorHandler);
  return app;
}
