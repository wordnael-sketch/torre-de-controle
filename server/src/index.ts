import 'dotenv/config';
import { createApp } from './app';

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
