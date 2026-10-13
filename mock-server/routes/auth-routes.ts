import {
  acceptInviteSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  SESSION_COOKIE,
} from '@shared/contract/index.ts';
import type { FastifyInstance } from 'fastify';
import { parse, sessionUser, setSessionCookie } from '../context.ts';

export async function authRoutes(app: FastifyInstance) {
  const ctx = app.mock;
  const { accounts } = ctx;

  app.post('/login', async (req, reply) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = accounts.verify(email, password);
    setSessionCookie(reply, accounts.createSession(user.id));
    return accounts.me(user);
  });

  app.post('/logout', async (req, reply) => {
    sessionUser(ctx, req);
    accounts.endSession(req.cookies[SESSION_COOKIE]!);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/me', async (req) => accounts.me(sessionUser(ctx, req)));

  app.post('/forgot-password', async (req, reply) => {
    accounts.requestReset(parse(forgotPasswordSchema, req.body).email);
    return reply.code(202).send();
  });

  app.post('/reset-password', async (req, reply) => {
    const { token, password } = parse(resetPasswordSchema, req.body);
    accounts.resetPassword(token, password);
    return reply.code(204).send();
  });

  app.get<{ Params: { token: string } }>('/invites/:token', async (req) => {
    const invite = accounts.openInvite(req.params.token);
    return { email: invite.email, expiresAt: invite.expiresAt };
  });

  app.post('/accept-invite', async (req, reply) => {
    const { token, name, password } = parse(acceptInviteSchema, req.body);
    const user = accounts.acceptInvite(token, name, password);
    setSessionCookie(reply, accounts.createSession(user.id));
    return accounts.me(user);
  });
}
