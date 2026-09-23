/**
 * Servidor de desarrollo: sirve dist/ y ejecuta las funciones de Netlify tal
 * cual, con un almacén en disco en lugar de Netlify Blobs.
 *
 * Es el mismo código que corre en producción; lo único distinto es dónde se
 * guardan los bytes. Sirve para probar el panel completo sin desplegar.
 *
 *   node tools/dev.mjs [puerto]
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const DATA = process.env.CARBOLITAS_DEV_DATA || join(ROOT, '.dev-data');

/* --- almacén local con la misma forma que Netlify Blobs --- */
const nombreArchivo = (key) => join(DATA, key.replace(/[^a-zA-Z0-9._/-]/g, '_'));
const ETAGS = new Map();
let sello = 0;
globalThis.__CARBOLITAS_BLOBS__ = () => ({
  async getWithMetadata(key, opts = {}) {
    const file = nombreArchivo(key);
    if (!existsSync(file)) return null;
    const buf = await readFile(file);
    const valor = opts.type === 'json' ? JSON.parse(buf.toString('utf8')) : buf.toString('utf8');
    return { data: valor, etag: ETAGS.get(key) };
  },
  async get(key, opts = {}) {
    const file = nombreArchivo(key);
    if (!existsSync(file)) return null;
    const buf = await readFile(file);
    if (opts.type === 'json') return JSON.parse(buf.toString('utf8'));
    if (opts.type === 'arrayBuffer') return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return buf.toString('utf8');
  },
  async set(key, value) {
    const file = nombreArchivo(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, Buffer.isBuffer(value) ? value : Buffer.from(value));
    ETAGS.set(key, String(++sello));
  },
  async setJSON(key, value, opts = {}) {
    if (opts.onlyIfMatch !== undefined && ETAGS.get(key) !== opts.onlyIfMatch) {
      throw new Error('conflicto');
    }
    if (opts.onlyIfNew && existsSync(nombreArchivo(key))) throw new Error('ya existe');
    const file = nombreArchivo(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
    ETAGS.set(key, String(++sello));
  },
  async delete(key) {
    await rm(nombreArchivo(key), { force: true });
    ETAGS.delete(key);
  }
});

const RUTAS = {
  '/carta.json': () => import('../netlify/functions/carta.mjs'),
  '/api/entrar': () => import('../netlify/functions/entrar.mjs'),
  '/api/publicar': () => import('../netlify/functions/publicar.mjs'),
  '/api/foto': () => import('../netlify/functions/foto.mjs')
};

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript'
};

function resolver(pathname) {
  if (RUTAS[pathname]) return RUTAS[pathname];
  if (pathname.startsWith('/api/foto/')) return RUTAS['/api/foto'];
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const handler = resolver(url.pathname);

  if (handler) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const mod = await handler();
    const request = new Request(url.href, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)
    });
    try {
      const out = await mod.default(request, {});
      const headers = {};
      out.headers.forEach((v, k) => (headers[k] = v));
      res.writeHead(out.status, headers);
      res.end(Buffer.from(await out.arrayBuffer()));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(err && err.message) }));
    }
    return;
  }

  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(DIST, rel === '/' ? 'index.html' : rel);
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TIPOS[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('no encontrado');
  }
});

const puerto = Number(process.argv[2] || process.env.PORT || 4321);
server.listen(puerto, () => {
  console.log(`carta   http://127.0.0.1:${puerto}/`);
  console.log(`panel   http://127.0.0.1:${puerto}/admin.html`);
  console.log(`datos   ${DATA}`);
  if ((process.env.ADMIN_PASSWORD || '').length < 12)
    console.log('aviso   ADMIN_PASSWORD ausente o de menos de 12 caracteres: el panel no dejará entrar');
});
