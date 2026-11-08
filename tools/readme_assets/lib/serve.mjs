// A small static file server for the capture script.
//
// It serves one build of the web client (web/dist-e2e) on 127.0.0.1, on a port the system picks,
// the way a static host would: the right type for .wasm and .whl files, and the page's
// Content-Security-Policy as a header on every answer, which is what puts the host worker
// under the policy too. It reads files and nothing else: GET and HEAD only, no directory
// listings, and a request that leaves the folder is refused.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.zip', 'application/zip'],
  ['.whl', 'application/octet-stream'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.woff2', 'font/woff2'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function typeOf(file) {
  return TYPES.get(path.extname(file).toLowerCase()) ?? 'application/octet-stream';
}

const ENTITIES = new Map([
  ['&#39;', "'"],
  ['&quot;', '"'],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&amp;', '&'],
]);

/**
 * The Content-Security-Policy in the <meta> tag of the page, which is the policy the build was
 * made with. `lantern-eve play` reads it from the same place.
 */
export async function policyOf(root) {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const tag = /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/i.exec(html);
  if (tag === null) throw new Error(`${path.join(root, 'index.html')} has no Content-Security-Policy meta tag`);
  return tag[1].replace(/&#?\w+;/g, (entity) => ENTITIES.get(entity) ?? entity);
}

/**
 * Start the server.
 * @param {{root: string, policy?: string}} options
 *   root    the folder served at "/"
 *   policy  the Content-Security-Policy to send (default: the one in index.html)
 * @returns {Promise<{origin: string, port: number, close: () => Promise<void>}>}
 */
export async function serve({ root, policy }) {
  const base = path.resolve(root);
  const csp = policy ?? (await policyOf(base));
  const server = createServer(async (request, response) => {
    const fail = (code) => {
      response.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'content-security-policy': csp });
      response.end(`${code}\n`);
    };
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405);
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return fail(400);
      }
      if (pathname.includes('\0')) return fail(400);
      const wanted = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
      const file = path.resolve(base, `.${wanted}`);
      if (file !== base && !file.startsWith(base + path.sep)) return fail(403);
      const info = await stat(file).catch(() => null);
      if (info === null || !info.isFile()) return fail(404);
      const body = await readFile(file);
      response.writeHead(200, {
        'content-type': typeOf(file),
        'content-length': body.length,
        'content-security-policy': csp,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      fail(500);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
