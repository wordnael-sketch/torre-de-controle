import 'dotenv/config';
import { createApp } from './app';
import { createDb } from './db';
import { createGoogleVerifier } from './auth/googleVerifier';
import { createAnthropicClassifier, createGeminiClassifier } from './services/classifier';
import { createHttpTrelloClient } from './services/trello';
import type { Express } from 'express';

export async function createAppFromEnv(): Promise<Express> {
  const connectionString = process.env.DATABASE_URL;
  const jwtSecret = process.env.JWT_SECRET;
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN ?? 'ilhacrossmidia.com.br';
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const trelloApiKey = process.env.TRELLO_API_KEY;
  const trelloToken = process.env.TRELLO_TOKEN;
  const trelloBoardId = process.env.TRELLO_BOARD_ID;
  const trelloWebhookSecret = process.env.TRELLO_API_SECRET;
  const trelloWebhookCallbackUrl = process.env.TRELLO_WEBHOOK_CALLBACK_URL;
  const trelloConfigured = Boolean(trelloApiKey && trelloToken && trelloBoardId);

  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  if (!googleClientId) {
    throw new Error('GOOGLE_CLIENT_ID environment variable is required');
  }

  const db = await createDb(connectionString);

  return createApp({
    db,
    verifyIdToken: createGoogleVerifier(googleClientId),
    jwtSecret,
    allowedDomain,
    frontendUrl,
    // Gemini tem prioridade quando as duas estão configuradas — foi o pedido
    // ao trocar de provedor (créditos da Anthropic esgotados).
    classifier: geminiApiKey
      ? createGeminiClassifier(geminiApiKey)
      : anthropicApiKey
        ? createAnthropicClassifier(anthropicApiKey)
        : undefined,
    trelloClient: trelloConfigured
      ? createHttpTrelloClient(trelloApiKey!, trelloToken!, trelloBoardId!)
      : undefined,
    trelloWebhookSecret,
    trelloWebhookCallbackUrl,
  });
}
