import { Router } from 'express';
import crypto from 'crypto';
import type { AppDatabase } from '../db';
import { getJobByTrelloCardId } from '../models/job';
import { syncJobFromTrello } from '../models/trelloLink';
import type { Classifier } from '../services/classifier';
import type { TrelloClient } from '../services/trello';
import { asyncHandler } from '../utils/asyncHandler';

export interface TrelloWebhookRouterDeps {
  db: AppDatabase;
  classifier?: Classifier;
  trelloClient?: TrelloClient;
  trelloWebhookSecret?: string;
  trelloWebhookCallbackUrl?: string;
}

interface TrelloWebhookPayload {
  action?: {
    data?: {
      card?: {
        id?: string;
      };
    };
  };
}

function isValidTrelloSignature(
  rawBody: Buffer,
  headerSignature: string | undefined,
  secret: string,
  callbackUrl: string,
): boolean {
  if (!headerSignature) {
    return false;
  }

  const computed = crypto
    .createHmac('sha1', secret)
    .update(Buffer.concat([rawBody, Buffer.from(callbackUrl)]))
    .digest('base64');

  const computedBuf = Buffer.from(computed);
  const headerBuf = Buffer.from(headerSignature);
  if (computedBuf.length !== headerBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(computedBuf, headerBuf);
}

/**
 * No user auth here — the Trello webhook is not a logged-in user. Security
 * comes entirely from the HMAC signature check below. Always responds 200
 * for anything it processes (even "nothing to do" cases) so Trello never
 * sees enough consecutive failures to disable the webhook; 401 is reserved
 * for a signature that doesn't verify. See
 * docs/superpowers/specs/2026-08-21-trello-webhook-design.md.
 */
export function createTrelloWebhookRouter(deps: TrelloWebhookRouterDeps): Router {
  const router = Router();

  router.head('/', (_req, res) => {
    res.status(200).end();
  });

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      if (
        !deps.trelloClient ||
        !deps.classifier ||
        !deps.trelloWebhookSecret ||
        !deps.trelloWebhookCallbackUrl
      ) {
        res.status(200).json({ ok: true });
        return;
      }

      const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
      const signature = req.header('x-trello-webhook');

      if (!isValidTrelloSignature(rawBody, signature, deps.trelloWebhookSecret, deps.trelloWebhookCallbackUrl)) {
        res.status(401).json({ error: 'invalid_signature' });
        return;
      }

      const payload = req.body as TrelloWebhookPayload;
      const cardId = payload.action?.data?.card?.id;
      if (!cardId) {
        res.status(200).json({ ok: true });
        return;
      }

      const job = await getJobByTrelloCardId(deps.db, cardId);
      if (!job) {
        res.status(200).json({ ok: true });
        return;
      }

      try {
        await syncJobFromTrello(deps.db, deps.trelloClient, deps.classifier, job, {
          bypassConfidenceGate: true,
        });
      } catch (err) {
        console.error('trello webhook sync failed', err);
      }

      res.status(200).json({ ok: true });
    }),
  );

  return router;
}
