import 'dotenv/config';
import { createApp } from './app';
import { createDb } from './db';
import { createGoogleVerifier } from './auth/googleVerifier';

const port = Number(process.env.PORT ?? 4000);
const connectionString = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN ?? 'ilhacrossmidia.com.br';
const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}
if (!jwtSecret) {
  throw new Error('JWT_SECRET environment variable is required');
}
if (!googleClientId) {
  throw new Error('GOOGLE_CLIENT_ID environment variable is required');
}

async function main() {
  const db = await createDb(connectionString!);

  const app = createApp({
    db,
    verifyIdToken: createGoogleVerifier(googleClientId!),
    jwtSecret: jwtSecret!,
    allowedDomain,
    frontendUrl,
  });

  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
