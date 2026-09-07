/* Arrow Exodus — local static file server + /api/v1/time (UTC). */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.opus': 'audio/ogg'
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    pathname = decodeURIComponent(url.pathname);
  } catch (err) { // malformed URL or bad percent-encoding must not crash the process
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('bad request');
    return;
  }

  if (pathname === '/api/v1/time') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ now: Date.now(), utcDate: new Date().toISOString().slice(0, 10) }));
    return;
  }

  const filePath = pathname === '/' ? indexHtmlPath() : path.join(ROOT, pathname);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found: ' + pathname);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

function indexHtmlPath() { return path.join(ROOT, 'index.html'); }

server.listen(PORT, () => {
  console.log('Arrow Exodus server listening on http://localhost:' + PORT);
});

export { server };
