import express from 'express';
import Stripe from 'stripe';
import { readConfig } from './src/config.js';
import { connectDatabase } from './src/db.js';
import { createAuthentication } from './src/auth.js';
import { createGuards } from './src/middleware/authenticate.js';
import { createApp } from './src/app.js';
const config = readConfig();
export const { db, client } = await connectDatabase(config);
const auth = createAuthentication(db, client, config);
const context = {
  db,
  client,
  config,
  auth,
  stripe: config.STRIPE_SECRET_KEY ? new Stripe(config.STRIPE_SECRET_KEY) : null,
};
context.guards = createGuards(context);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(createApp(context));
export default app;
