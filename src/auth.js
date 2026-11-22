import { betterAuth } from 'better-auth';
import { mongodbAdapter } from '@better-auth/mongo-adapter';
import { jwt } from 'better-auth/plugins';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { objectId } from './db.js';

export function createAuthentication(db, client, config) {
  return betterAuth({
    appName: 'SalonBook', baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    database: mongodbAdapter(db, {client}),
    trustedOrigins: [config.CLIENT_URL],
    emailAndPassword: {enabled: true, minPasswordLength: 6, maxPasswordLength: 128},
    user: {modelName: 'users', additionalFields: {
      role: {type: 'string', defaultValue: 'customer', input: false},
      isBlocked: {type: 'boolean', defaultValue: false, input: false},
      phone: {type: 'string', required: false},
    }},
    socialProviders: config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET ? {
      google: {clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET},
    } : {},
    session: {expiresIn: 60 * 60 * 24 * 7, cookieCache: {enabled: false}},
    plugins: [jwt({jwt: {
      issuer: config.BETTER_AUTH_URL, audience: 'salonbook-api', expirationTime: '15m',
      definePayload: ({user, session}) => ({sub: user.id, sessionId: session.id}),
    }})],
    hooks: {before: createAuthMiddleware(async ctx => {
      if (ctx.path === '/sign-up/email' || ctx.path === '/change-password' || ctx.path === '/set-password' || ctx.path === '/reset-password') {
        const password = ctx.body?.newPassword || ctx.body?.password;
        if (password && (!/[A-Z]/.test(password) || !/[a-z]/.test(password))) throw new APIError('BAD_REQUEST', {message: 'Password needs an uppercase and a lowercase letter.'});
      }
    })},
    databaseHooks: {session: {create: {before: async session => {
      const user = await db.collection('users').findOne({_id: objectId(session.userId)});
      if (user?.isBlocked) throw new APIError('FORBIDDEN', {message: 'Your account is blocked. Contact the salon.'});
      return {data: session};
    }}}},
    advanced: {useSecureCookies: config.NODE_ENV === 'production'},
  });
}
