import app, { client } from '../index.js';
const port = Number(process.env.PORT) || 4000;
const server = app.listen(port, () => console.log(`SalonBook API listening on port ${port}`));
async function shutdown() {
  server.close(async () => {
    await client.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
