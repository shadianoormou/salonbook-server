import { z } from 'zod';
import { HttpError } from './errors.js';
export const categories = [
  'Haircut & Styling',
  'Hair Coloring',
  'Hair Treatment',
  'Facial & Skincare',
  'Makeup',
  'Manicure & Pedicure',
  'Spa & Massage',
];
export const timeSlots = Array.from(
  { length: 18 },
  (_, i) => `${String(10 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`,
);
export const serviceSchema = z
  .object({
    serviceName: z.string().trim().min(3).max(100),
    category: z.enum(categories),
    description: z.string().trim().min(20).max(3000),
    price: z
      .number()
      .positive()
      .max(10000)
      .refine(
        (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.000001,
        'Use at most two decimal places',
      ),
    duration: z.number().int().positive().max(480),
    image: z.url(),
    status: z.enum(['active', 'inactive']).default('active'),
  })
  .strict();
export const appointmentSchema = z
  .object({
    serviceId: z.string().regex(/^[a-f\d]{24}$/i),
    appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timeSlot: z.enum(timeSlots),
    message: z.string().trim().max(1000).default(''),
  })
  .strict();
export function salonNow(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map((v) => [v.type, v.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
export function validateBookingDate(date, slot, timeZone) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
    throw new HttpError(400, 'Choose a valid appointment date.');
  const now = salonNow(timeZone);
  if (date < now.date || (date === now.date && slot <= now.time))
    throw new HttpError(400, 'Please choose a future appointment time.');
  if (parsed.getTime() > Date.now() + 180 * 86400000)
    throw new HttpError(400, 'Please book within the next 180 days.');
}
export const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function pagination(query) {
  const page = Math.max(1, Math.min(100000, Number.parseInt(query.page) || 1));
  const limit = Math.max(1, Math.min(50, Number.parseInt(query.limit) || 12));
  return { page, limit, skip: (page - 1) * limit };
}
