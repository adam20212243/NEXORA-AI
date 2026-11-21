import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getDatabase } from './server/db/database.ts';
import { ensureStarterKnowledgeSeeded } from './server/knowledge/starterPack.ts';
import { createApiRouter } from './server/routes/api.ts';

async function startServer() {
  const db = getDatabase();
  const seedInfo = ensureStarterKnowledgeSeeded();
  if (seedInfo.seeded) {
    console.log(`[NEXORA] Seeded ${seedInfo.count} foundational verified knowledge records.`);
  }

  const app = express();
  app.use(express.json({ limit: '15mb' }));
  app.use('/api', createApiRouter());

  const port = Number(process.env.PORT ?? 3000);
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`[NEXORA AI] Server listening on http://0.0.0.0:${port}`);
    console.log(`[NEXORA AI] Database active (${db ? 'connected' : 'unavailable'})`);
  });

  return server;
}

startServer().catch((err) => {
  console.error('[NEXORA AI] Fatal startup error:', err);
  process.exit(1);
});
