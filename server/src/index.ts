import { createAppFromEnv } from './createAppFromEnv';

const port = Number(process.env.PORT ?? 4000);

createAppFromEnv()
  .then((app) => {
    app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
      if (!process.env.ANTHROPIC_API_KEY) {
        console.warn('ANTHROPIC_API_KEY not set — POST /api/jobs/:id/classify will return 503');
      }
      if (!process.env.TRELLO_API_KEY || !process.env.TRELLO_TOKEN || !process.env.TRELLO_BOARD_ID) {
        console.warn(
          'TRELLO_API_KEY/TRELLO_TOKEN/TRELLO_BOARD_ID not fully set — Trello integration endpoints will return 503',
        );
      }
    });
  })
  .catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
