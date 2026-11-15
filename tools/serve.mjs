// Petit serveur local pour essayer l'app : node tools/serve.mjs [port] [/sous-dossier]
// Sert le dossier de l'app, sans cache. /__xlsx renvoie l'Excel voisin (test de l'import, en local seulement).
// Avec un sous-dossier (ex. /fiche-presence), l'app est servie sous ce chemin, comme sur GitHub Pages.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = +(process.argv[2] || process.env.PORT || 5173);
const base = (process.argv[3] || '').replace(/\/+$/, '');
const xlsx = process.env.FP_XLSX || path.join(root, '..', 'emploi-du-temps-3A_01nov.xlsx');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel === '/__xlsx') {
    return fs.readFile(xlsx, (err, data) => {
      res.writeHead(err ? 404 : 200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(err ? '' : data);
    });
  }
  if (base) {
    if (rel === base) { res.writeHead(302, { Location: base + '/' }); return res.end(); }
    if (!rel.startsWith(base + '/')) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404'); }
    rel = rel.slice(base.length);
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log(`Fiche de présence : http://localhost:${port}${base}/`));
