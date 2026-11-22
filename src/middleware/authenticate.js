import { createLocalJWKSet, jwtVerify } from 'jose';
import { fromNodeHeaders } from 'better-auth/node';
import { objectId } from '../db.js';
import { HttpError } from '../errors.js';

export function createGuards({ db, auth, config }) {
  const authenticate = async (req, res, next) => {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new HttpError(401, 'Please sign in to continue.');
    let payload;
    try {
      const keys = await auth.api.getJwks();
      ({ payload } = await jwtVerify(token, createLocalJWKSet(keys), {
        issuer: config.BETTER_AUTH_URL,
        audience: 'salonbook-api',
        algorithms: ['EdDSA'],
      }));
    } catch {
      throw new HttpError(401, 'Your session has expired. Please sign in again.');
    }
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session || session.user.id !== payload.sub || session.session.id !== payload.sessionId)
      throw new HttpError(401, 'Please sign in again.');
    const user = await db
      .collection('users')
      .findOne(
        { _id: objectId(payload.sub) },
        { projection: { name: 1, email: 1, image: 1, role: 1, isBlocked: 1, phone: 1 } },
      );
    if (!user) throw new HttpError(401, 'Account not found.');
    if (user.isBlocked)
      throw new HttpError(403, 'Your account is blocked. Please contact the salon.');
    req.user = { ...user, id: user._id.toString() };
    next();
  };
  const role = (expected) => (req, res, next) => {
    if (req.user.role !== expected)
      throw new HttpError(403, 'You do not have access to this area.');
    next();
  };
  return { authenticate, role };
}
