import { hasOwner, launchConfig, startServer } from './standalone.mjs';

try {
  const config = launchConfig(process.env, true);
  if (!hasOwner(config.dataDir)) throw Error('Сначала создайте владельца: docker compose run --rm app node server/setup.mjs');
  await startServer(config);
} catch (error) { console.error(error.message); process.exitCode = 1; }
