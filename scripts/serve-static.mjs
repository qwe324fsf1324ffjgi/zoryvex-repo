#!/usr/bin/env node
// Minimal static file server for running Playwright against a real static
// export build (no framework dev server, matches what CloudFront/S3 will
// actually serve). Usage: node scripts/serve-static.mjs <dir> <port>
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const [, , dirArg, portArg] = process.argv;
const dir = dirArg ?? 'apps/web/out';
const port = Number(portArg ?? 4173);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

/**
 * Next.js App Router static export writes a route like /for-talent as a
 * sibling `for-talent.html` file AND a same-named directory containing only
 * route-manifest artifacts (no index.html) — so directory-first resolution
 * would 404 on every non-root route. Try, in order: the exact path (real
 * static assets like /founder/founder-320.jpg), `<path>.html` (the normal
 * App Router route output), then `<path>/index.html` (trailing-slash-style
 * output, if that mode is ever turned on).
 */
async function resolvePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  if (clean === '/') return join(dir, 'index.html');

  const asIs = join(dir, clean);
  const asHtml = extname(clean) ? null : `${asIs}.html`;
  const asIndex = join(asIs, 'index.html');

  for (const candidate of [asIs, asHtml, asIndex].filter((c) => c !== null)) {
    try {
      await readFile(candidate);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  return asHtml ?? asIs; // let the caller's readFile produce the real error
}

const server = createServer(async (req, res) => {
  try {
    const filePath = await resolvePath(req.url ?? '/');
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream',
    });
    res.end(body);
  } catch {
    try {
      const fallback = await readFile(join(dir, '404.html'));
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(fallback);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  }
});

server.listen(port, () => {
  console.log(`Serving ${dir} at http://localhost:${port}`);
});
