import { AUDIT_CSV_HEADER, auditQuerySchema } from '@shared/contract/index.ts';
import type { FastifyInstance } from 'fastify';
import { authorize, parse, sessionUser } from '../context.ts';
import { HttpError } from '../http-error.ts';

type IdParams = { Params: { id: string } };

const IST_MS = 330 * 60_000;
/** `2026-10-16 14:05:09` in IST. */
const istStamp = (t: number) => new Date(t + IST_MS).toISOString().slice(0, 19).replace('T', ' ');

const csvCell = (v: string | number | null) => {
  const s = v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * F29 (D-166…D-168): Confirm / Cancel / Undo of assistant proposals and the audit log.
 * - `POST /actions/:id/confirm|cancel` — the proposer only (404 for anyone else).
 * - `POST /actions/:id/undo` — the proposer, or `audit.view` + the action's own permission.
 * - `GET /audit`, `GET /audit.csv` — `audit.view`.
 */
export async function actionRoutes(app: FastifyInstance) {
  const ctx = app.mock;

  app.post<IdParams>('/actions/:id/confirm', async (req) =>
    ctx.actions.confirm(sessionUser(ctx, req), req.params.id),
  );

  app.post<IdParams>('/actions/:id/cancel', async (req) =>
    ctx.actions.cancel(sessionUser(ctx, req), req.params.id),
  );

  app.post<IdParams>('/actions/:id/undo', async (req) =>
    ctx.actions.undo(sessionUser(ctx, req), req.params.id),
  );

  app.get<IdParams>('/actions/:id', async (req) => {
    const user = sessionUser(ctx, req);
    const card = ctx.actions.cardFor(user.id, req.params.id);
    if (!card) throw new HttpError(404, 'not_found', `Action ${req.params.id} not found`);
    return card;
  });

  app.get('/audit', async (req) => {
    const { user } = authorize(ctx, req, 'audit.view');
    return ctx.actions.auditPage(user, parse(auditQuerySchema, req.query));
  });

  app.get('/audit.csv', async (req, reply) => {
    const { user } = authorize(ctx, req, 'audit.view');
    const entries = ctx.actions.auditAll(user, parse(auditQuerySchema, req.query));
    const lines = [
      AUDIT_CSV_HEADER.join(','),
      ...entries.map((e) =>
        [
          istStamp(e.at),
          e.actorName,
          e.area,
          e.kind,
          e.summary,
          e.target ? `${e.target.type}:${e.target.label}` : null,
          e.status,
        ]
          .map(csvCell)
          .join(','),
      ),
    ];
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="activity.csv"')
      .send(lines.join('\n') + '\n');
  });
}
