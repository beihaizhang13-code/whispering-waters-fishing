/**
 * 《微风垂钓物语 2.0》本地全栈开发预览服务器 (server.js)
 * ----------------------------------------------------------------------------
 * 特性：
 * 1. 静态资源白名单 + path.resolve 前缀防御路径遍历（严禁访问 .env / .git / backend / db / data）；
 * 2. 将 /api/* 请求转换为标准 Web Request 转发至 backend/http/router.mjs，与 Netlify Functions 共享同一路由；
 * 3. 支持导出 createAppServer() 供自动化集成测试复用。
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname);
const ALLOWED_STATIC_ROOTS = new Map([
  ['/css/', path.resolve(ROOT_DIR, 'css')],
  ['/js/', path.resolve(ROOT_DIR, 'js')],
  ['/shared/', path.resolve(ROOT_DIR, 'shared')]
]);
const ALLOWED_EXACT_FILES = new Map([
  ['/', path.resolve(ROOT_DIR, 'index.html')],
  ['/index.html', path.resolve(ROOT_DIR, 'index.html')],
  ['/manifest.webmanifest', path.resolve(ROOT_DIR, 'manifest.webmanifest')]
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const MAX_API_BODY_BYTES = 2 * 1024 * 1024; // 2 MB

function resolveSafeStaticFile(urlPath) {
  if (urlPath.includes('\0')) return { status: 400, filePath: null };

  if (ALLOWED_EXACT_FILES.has(urlPath)) {
    return { status: 200, filePath: ALLOWED_EXACT_FILES.get(urlPath) };
  }

  for (const [prefix, baseDir] of ALLOWED_STATIC_ROOTS.entries()) {
    if (!urlPath.startsWith(prefix)) continue;
    const rel = urlPath.slice(prefix.length);
    if (!rel || rel.includes('..') || path.isAbsolute(rel)) {
      return { status: 403, filePath: null };
    }
    const candidate = path.resolve(baseDir, rel);
    if (candidate !== baseDir && !candidate.startsWith(baseDir + path.sep)) {
      return { status: 403, filePath: null };
    }
    return { status: 200, filePath: candidate };
  }

  return { status: 403, filePath: null };
}

function readRequestBody(req, limitBytes = MAX_API_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > limitBytes) {
        const err = new Error('请求体超出 2MB 限制');
        err.status = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function buildWebHeaders(nodeHeaders) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders || {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, String(value));
    }
  }
  return headers;
}

async function createAppServer(options = {}) {
  const [{ loadConfig }, { createApiHandler }] = await Promise.all([
    import('./backend/config/env.mjs'),
    import('./backend/http/router.mjs')
  ]);

  const config = options.config || loadConfig({
    cwd: ROOT_DIR,
    dbPath: options.dbPath
  });
  const apiHandler = options.apiHandler || createApiHandler({ config });

  const server = http.createServer(async (req, res) => {
    const rawUrl = req.url || '/';
    let pathname;
    try {
      pathname = decodeURIComponent(rawUrl.split('?')[0]);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('400 Bad Request');
      return;
    }

    // 1. API 网关分支 (/api/*)
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      try {
        const hostHeader = req.headers.host || `${config.host}:${config.port}`;
        const fullUrl = `http://${hostHeader}${rawUrl}`;
        const method = (req.method || 'GET').toUpperCase();
        const hasBody = method !== 'GET' && method !== 'HEAD';
        const bodyBuf = hasBody ? await readRequestBody(req) : undefined;

        const webReq = new Request(fullUrl, {
          method,
          headers: buildWebHeaders(req.headers),
          ...(hasBody && bodyBuf && bodyBuf.length > 0 ? { body: bodyBuf } : {})
        });

        const webRes = await apiHandler.handleRequest(webReq, { runtime: 'node-local' });
        const outHeaders = {};
        webRes.headers.forEach((v, k) => {
          outHeaders[k] = v;
        });

        const outBuffer = Buffer.from(await webRes.arrayBuffer());
        res.writeHead(webRes.status, outHeaders);
        res.end(outBuffer);
      } catch (err) {
        const status = err?.status || 500;
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: err?.message || 'Internal Server Error' }
        }));
      }
      return;
    }

    // 2. 静态资源安全白名单分支
    const resolved = resolveSafeStaticFile(pathname);
    if (!resolved.filePath) {
      res.writeHead(resolved.status, {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(resolved.status === 400 ? '400 Bad Request' : '403 Forbidden: ' + pathname);
      return;
    }

    fs.readFile(resolved.filePath, (err, data) => {
      if (err) {
        res.writeHead(404, {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff'
        });
        res.end('404 Not Found: ' + pathname);
        return;
      }
      const ext = path.extname(resolved.filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin'
      });
      res.end(data);
    });
  });

  return {
    server,
    config,
    apiHandler,
    async close() {
      await new Promise(resolve => server.close(() => resolve()));
      if (apiHandler && typeof apiHandler.close === 'function') {
        await apiHandler.close();
      }
    }
  };
}

if (require.main === module) {
  createAppServer()
    .then(({ server, config }) => {
      server.listen(config.port, config.host, () => {
        console.log(`Whispering Waters Fishing server running at http://${config.host}:${config.port}/index.html`);
        console.log(`Health endpoint: http://${config.host}:${config.port}/api/v1/health`);
      });
    })
    .catch(err => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}

module.exports = {
  createAppServer,
  resolveSafeStaticFile
};
