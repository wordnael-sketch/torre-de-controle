import 'dotenv/config';
import { createApp } from './app';
import { createDb } from './db';
import { createGoogleVerifier } from './auth/googleVerifier';
import { createAnthropicClassifier } from './services/classifier';
import type { Express } from 'express';

export async function createAppFromEnv(): Promise<Express> {
  const connectionString = process.env.DATABASE_URL;
  const jwtSecret = process.env.JWT_SECRET;
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN ?? 'ilhacrossmidia.com.br';
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

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
    classifier: anthropicApiKey ? createAnthropicClassifier(anthropicApiKey) : undefined,
  });
}
