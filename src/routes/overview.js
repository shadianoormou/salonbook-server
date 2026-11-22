import { Router } from 'express';
import { pagination } from '../domain.js';
export function overviewRoutes({ db, guards }) {
  const router = Router();
  router.use(guards.authenticate);
  router.get('/', async (req, res) => {
    const filter = req.user.role === 'admin' ? {} : { customerId: req.user._id };
    const counts = await db
      .collection('appointments')
      .aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }])
      .toArray();
    const data = {
      totalAppointments: counts.reduce((sum, c) => sum + c.count, 0),
      pending: 0,
      confirmed: 0,
      cancelled: 0,
    };
    for (const c of counts) data[c._id] = c.count;
    if (req.user.role === 'admin') {
      const [customers, services, payments] = await Promise.all([
        db.collection('users').countDocuments({ role: 'customer' }),
        db.collection('services').countDocuments({ status: 'active' }),
        db
          .collection('transactions')
          .aggregate([
            { $match: { status: 'paid' } },
            { $group: { _id: '$currency', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
          ])
          .toArray(),
      ]);
      Object.assign(data, {
        customers,
        services,
        payments: payments.reduce((s, p) => s + p.count, 0),
        revenueByCurrency: payments,
      });
    }
    res.json({ data });
  });
  return router;
}
export function transactionRoutes({ db, guards }) {
  const router = Router();
  router.use(guards.authenticate);
  router.get('/', async (req, res) => {
    const { page, limit, skip } = pagination(req.query),
      filter = req.user.role === 'admin' ? {} : { customerId: req.user._id };
    const [data, total] = await Promise.all([
      db
        .collection('transactions')
        .aggregate([
          { $match: filter },
          { $sort: { createdAt: -1 } },
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: 'users',
              localField: 'customerId',
              foreignField: '_id',
              pipeline: [{ $project: { name: 1, email: 1, image: 1 } }],
              as: 'customer',
            },
          },
          { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: 'appointments',
              localField: 'appointmentId',
              foreignField: '_id',
              as: 'appointment',
            },
          },
          { $unwind: { path: '$appointment', preserveNullAndEmptyArrays: true } },
        ])
        .toArray(),
      db.collection('transactions').countDocuments(filter),
    ]);
    res.json({ data, total, page, pages: Math.ceil(total / limit) });
  });
  return router;
}
