import { Router } from 'express';
import crypto from 'crypto';
import type { AppDatabase } from '../db';
import { getJobByTrelloCardId } from '../models/job';
import { syncJobFromTrello, createJobFromTrelloCard } from '../models/trelloLink';
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
    type?: string;
    memberCreator?: {
      fullName?: string;
    };
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
      if (!deps.trelloClient || !deps.trelloWebhookSecret || !deps.trelloWebhookCallbackUrl) {
        console.warn(
          'trello webhook received a request but is not fully configured (missing trelloClient/trelloWebhookSecret/trelloWebhookCallbackUrl)',
        );
        res.status(200).json({ ok: true });
        return;
      }
      // deps.classifier is intentionally NOT required here — member/Atendimento
      // matching is deterministic name-matching, not AI, and must still run
      // when ANTHROPIC_API_KEY isn't configured. Only the checklist-driven
      // status suggestions inside syncJobFromTrello need it, and that function
      // already treats classifier as optional.

      const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
      const signature = req.header('x-trello-webhook');

      if (!isValidTrelloSignature(rawBody, signature, deps.trelloWebhookSecret, deps.trelloWebhookCallbackUrl)) {
        console.warn('trello webhook received a request with an invalid or missing signature');
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
        // Sem job vinculado ainda: só vale a pena tentar importar quando é
        // exatamente o momento em que o card foi criado — qualquer outra
        // action (comentário, checklist etc.) num card sem job é ignorada,
        // senão todo o backlog de cards antigos nunca linkados viraria job
        // sozinho na primeira interação, o que ninguém pediu.
        if (payload.action?.type === 'createCard') {
          await createJobFromTrelloCard(
            deps.db,
            deps.trelloClient,
            deps.classifier,
            cardId,
            payload.action.memberCreator?.fullName,
          );
        }
        res.status(200).json({ ok: true });
        return;
      }

      await syncJobFromTrello(deps.db, deps.trelloClient, deps.classifier, job, {
        bypassConfidenceGate: true,
      });

      res.status(200).json({ ok: true });
    }),
  );

  return router;
}
