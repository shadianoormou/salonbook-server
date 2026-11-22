import { readConfig } from '../src/config.js';
import { connectDatabase } from '../src/db.js';
import { createAuthentication } from '../src/auth.js';
const config = readConfig(),
  { db, client } = await connectDatabase(config);
const image = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1000&q=85`;
const services = [
  [
    'Signature Cut & Finish',
    'Haircut & Styling',
    'A thoughtful consultation, a precision haircut, and a beautiful finish designed around you. Leave feeling fresh, confident, and completely yourself.',
    45,
    60,
    'photo-1560066984-138dadb4c035',
  ],
  [
    'Lived-in Colour',
    'Hair Coloring',
    'Soft dimension and naturally blended colour, tailored to complement your features. Includes a personal colour consultation and a gentle finishing treatment.',
    95,
    120,
    'photo-1522337360788-8b13dee7a37e',
  ],
  [
    'Botanical Hair Ritual',
    'Hair Treatment',
    'Restore softness and shine with a deeply nourishing treatment, a soothing scalp massage, and a relaxed blow-dry finish.',
    55,
    60,
    'photo-1600948836101-f9ffda59d250',
  ],
  [
    'The Radiance Facial',
    'Facial & Skincare',
    'A gentle cleansing and hydration ritual that refreshes tired skin. Thoughtful care, a calming facial massage, and a healthy, natural glow.',
    65,
    60,
    'photo-1570172619644-dfd03ed5d881',
  ],
  [
    'Everyday Soft Glam',
    'Makeup',
    'Fresh, luminous makeup that feels like you. A personalised consultation and carefully balanced colours for your next special occasion.',
    75,
    75,
    'photo-1487412947147-5cebf100ffc2',
  ],
  [
    'The Polished Manicure',
    'Manicure & Pedicure',
    'Give your hands a little attention with nail shaping, cuticle care, a nourishing hand massage, and your choice of a beautiful polish.',
    35,
    45,
    'photo-1604654894610-df63bc536371',
  ],
  [
    'Unwind Body Massage',
    'Spa & Massage',
    'Slow down with a restorative full-body massage. Gentle, considered pressure helps ease tension and leaves you feeling quietly renewed.',
    85,
    90,
    'photo-1544161515-4ab6ce6db874',
  ],
];
try {
  for (const [serviceName, category, description, price, duration, photo] of services) {
    await db
      .collection('services')
      .updateOne(
        { serviceName },
        {
          $setOnInsert: {
            serviceName,
            category,
            description,
            price,
            duration,
            image: image(photo),
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );
  }
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const email = process.env.ADMIN_EMAIL.toLowerCase();
    const existing = await db.collection('users').findOne({ email });
    if (!existing) {
      const auth = createAuthentication(db, client, config);
      await auth.api.signUpEmail({
        body: { name: 'SalonBook Admin', email, password: process.env.ADMIN_PASSWORD },
      });
    }
    await db
      .collection('users')
      .updateOne({ email }, { $set: { role: 'admin', isBlocked: false, updatedAt: new Date() } });
    console.log('Administrator account provisioned securely.');
  }
  console.log('Seven sample services are ready. Existing service records were preserved.');
} finally {
  await client.close();
}
