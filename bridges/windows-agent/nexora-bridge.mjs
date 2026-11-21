/**
 * NEXORA AI Local Windows Companion Bridge (Optional Local Trusted Component)
 * Listens strictly on 127.0.0.1:48920 and launches ONLY explicitly allowlisted Windows apps
 * after user confirmation. Never uses shell interpolation.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';

const ALLOWED_WINDOWS_APPS = {
  calculator: { command: 'calc.exe', args: [] },
  settings: { command: 'explorer.exe', args: ['ms-settings:'] },
  notepad: { command: 'notepad.exe', args: [] },
  vscode: { command: 'code', args: [] },
};

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url === '/health') {
    res.end(JSON.stringify({ ok: true, platform: 'windows', allowlisted: Object.keys(ALLOWED_WINDOWS_APPS) }));
    return;
  }

  if (req.method === 'POST' && req.url === '/launch') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4096) req.destroy();
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const appId = String(parsed.appId || '');
        const confirmed = Boolean(parsed.confirmed);
        if (!confirmed) {
          res.statusCode = 403;
          res.end(JSON.stringify({ error: 'Explicit user confirmation required.' }));
          return;
        }
        const entry = ALLOWED_WINDOWS_APPS[appId];
        if (!entry) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'App is not in the trusted Windows allowlist.' }));
          return;
        }
        const child = spawn(entry.command, entry.args, { detached: true, stdio: 'ignore', shell: false });
        child.unref();
        res.end(JSON.stringify({ launched: true, appId }));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invalid JSON request.' }));
      }
    });
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(48920, '127.0.0.1', () => {
  console.log('[NEXORA Windows Bridge] Listening on http://127.0.0.1:48920');
});
