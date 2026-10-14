import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractContacts } from './extractor.js';
import { createContactStore } from './contact-store.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const exportsDirectory = path.join(root, 'exports');
const maxBytes = 10 * 1024 * 1024;
const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };

export function createServer({ directory = exportsDirectory } = {}) {
  const store = createContactStore(directory);
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && assets[url.pathname]) {
        const [file, type] = assets[url.pathname];
        const body = await readFile(path.join(root, 'public', file));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        return res.end(body);
      }
      if (req.method === 'GET' && url.pathname === '/api/contacts') {
        const contacts = await store.list();
        return json(200, { contacts });
      }
      if (req.method === 'POST' && url.pathname === '/api/extract') {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return json(415, { error: 'Send HTML as JSON.' });
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(403, { error: 'Use this app from its local address.' });
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > maxBytes) { json(413, { error: 'HTML is too large. Use a file smaller than 10 MB.' }); return; }
          chunks.push(chunk);
        }
        let input;
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return json(400, { error: 'Invalid JSON request.' }); }
        if (typeof input?.html !== 'string' || !input.html.trim()) return json(400, { error: 'Paste HTML or choose a file first.' });
        const result = extractContacts(input.html);
        const saved = await store.append(result.contacts);
        return json(200, {
          ...result,
          contacts: saved.contacts,
          stats: { ...result.stats, added: saved.added, alreadySaved: saved.alreadySaved, totalSaved: saved.contacts.length }
        });
      }
      return json(404, { error: 'Not found.' });
    } catch (error) {
      if (!res.headersSent) json(error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? 'File not found.' : 'Could not extract or save the contacts. Please try again.' });
      else res.end();
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const server = createServer();
  server.on('error', error => { console.error(`Could not start app: ${error.message}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Contact extractor ready at http://localhost:${port}`));
}
