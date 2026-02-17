const http = require('http');
const { createReadStream, existsSync, statSync } = require('fs');
const { readFile } = require('fs/promises');
const path = require('path');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const SITE_ROOT = __dirname;
const INDEX_PATH = path.join(SITE_ROOT, 'index.html');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
};

const COMPRESSIBLE_PREFIXES = [
  'text/',
  'application/javascript',
  'application/json',
  'application/xml',
  'image/svg+xml',
];

function getMimeType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function isCompressible(mimeType) {
  return COMPRESSIBLE_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

function toSafeFilePath(pathname) {
  const normalized = path.posix.normalize(pathname);
  const relativePath = normalized.startsWith('/') ? normalized.slice(1) : normalized;
  const resolvedPath = path.resolve(SITE_ROOT, relativePath);
  const safeRoot = path.resolve(SITE_ROOT) + path.sep;
  if (resolvedPath !== path.resolve(SITE_ROOT) && !resolvedPath.startsWith(safeRoot)) {
    return null;
  }
  return resolvedPath;
}

function resolveRequestPath(pathname) {
  if (pathname === '/') return INDEX_PATH;

  const directPath = toSafeFilePath(pathname);
  if (directPath && existsSync(directPath) && statSync(directPath).isFile()) {
    return directPath;
  }

  if (!pathname.endsWith('.html')) {
    const htmlPath = toSafeFilePath(`${pathname}.html`);
    if (htmlPath && existsSync(htmlPath) && statSync(htmlPath).isFile()) {
      return htmlPath;
    }
  }

  if (!path.extname(pathname) || pathname.endsWith('/')) {
    const indexPath = toSafeFilePath(path.posix.join(pathname, 'index.html'));
    if (indexPath && existsSync(indexPath) && statSync(indexPath).isFile()) {
      return indexPath;
    }
  }

  return INDEX_PATH;
}

function sendFile(req, res, filePath) {
  const mimeType = getMimeType(filePath);
  const acceptGzip = (req.headers['accept-encoding'] || '').includes('gzip');
  const isIndex = filePath === INDEX_PATH;

  const baseHeaders = {
    'Content-Type': mimeType,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': isIndex ? 'public, max-age=300' : 'public, max-age=86400',
  };

  if (acceptGzip && isCompressible(mimeType)) {
    readFile(filePath)
      .then((buffer) => {
        zlib.gzip(buffer, (err, gzipped) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Internal Server Error');
            return;
          }

          res.writeHead(200, {
            ...baseHeaders,
            'Content-Encoding': 'gzip',
            Vary: 'Accept-Encoding',
          });
          res.end(gzipped);
        });
      })
      .catch(() => {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
      });
    return;
  }

  res.writeHead(200, baseHeaders);
  createReadStream(filePath)
    .on('error', () => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('Internal Server Error');
    })
    .pipe(res);
}

const server = http.createServer((req, res) => {
  let pathname = '/';
  try {
    const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    pathname = decodeURIComponent(parsed.pathname || '/');
  } catch {
    pathname = '/';
  }

  const filePath = resolveRequestPath(pathname);
  sendFile(req, res, filePath);
});

server.listen(PORT, () => {
  console.log(`markupR landing page serving on port ${PORT}`);
});
