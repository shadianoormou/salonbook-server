import { MongoClient, ObjectId } from 'mongodb';
export function objectId(id) {
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) return null;
  return new ObjectId(id);
}
export async function connectDatabase(config) {
  const client = new MongoClient(config.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(config.MONGODB_DB);
  await Promise.all([
    db.collection('users').createIndex({ email: 1 }, { unique: true }),
    db.collection('services').createIndex({ status: 1, category: 1, price: 1 }),
    db
      .collection('appointments')
      .createIndex(
        { appointmentDate: 1, timeSlot: 1 },
        { unique: true, partialFilterExpression: { slotReserved: true } },
      ),
    db.collection('appointments').createIndex({ customerId: 1, createdAt: -1 }),
    db.collection('transactions').createIndex({ stripeSessionId: 1 }, { unique: true }),
    db
      .collection('transactions')
      .createIndex(
        { appointmentId: 1 },
        { unique: true, partialFilterExpression: { status: 'paid' } },
      ),
  ]);
  return { client, db };
}
