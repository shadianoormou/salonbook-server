import { z } from 'zod';
const schema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.string().default('development'),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().default('salonbook'),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  AUTH_INTERNAL_URL: z.url().default('http://127.0.0.1:4000'),
  CLIENT_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_CURRENCY: z
    .string()
    .regex(/^[a-z]{3}$/)
    .default('usd'),
  IMGBB_API_KEY: z.string().optional(),
  SALON_TIMEZONE: z.string().default('Asia/Dhaka'),
});
export function readConfig(source = process.env) {
  const parsed = schema.safeParse(source);
  if (!parsed.success)
    throw new Error(
      `Missing or invalid environment variables: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  return parsed.data;
}
