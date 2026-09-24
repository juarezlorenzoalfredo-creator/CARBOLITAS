/**
 * Servidor de desarrollo: sirve dist/ y ejecuta las funciones del servidor tal
 * cual, con un almacén en disco en lugar del de la plataforma.
 *
 * Es el mismo código que corre en producción; lo único distinto es dónde se
 * guardan los bytes.
 *
 *   node tools/dev.mjs [puerto]            imita a Netlify
 *   node tools/dev.mjs [puerto] --vercel   imita a Vercel
 *
 * El modo Vercel no es decorativo: lee el vercel.json real y aplica su orden
 * de resolución, que es distinto al de Netlify —primero el sistema de
 * archivos, luego las reescrituras—. Es la única forma de comprobar antes de
 * desplegar que la carta la sirve la función y no un archivo estático que la
 * tapa.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarReglas } from './vercel-rutas.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const DATA = process.env.CARBOLITAS_DEV_DATA || join(ROOT, '.dev-data');
const VERCEL = process.argv.includes('--vercel');

/* --- almacén local: el mismo driver que usan las pruebas, sobre disco --- */
const { crear } = await import('../server/drivers/memoria.mjs');
globalThis.__CARBOLITAS_STORE__ = crear({ dir: DATA });

const FUNCIONES = {
  carta: () => import('../server/carta.mjs'),
  entrar: () => import('../server/entrar.mjs'),
  publicar: () => import('../server/publicar.mjs'),
  foto: () => import('../server/foto.mjs')
};

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript'
};

/* ---------- reglas de Vercel, leídas del vercel.json real ---------- */
const reglas = VERCEL ? cargarReglas(join(ROOT, 'vercel.json')) : null;
const cabecerasDe = (p) => (reglas ? reglas.cabecerasDe(p) : {});
const reescribir = (p) => (reglas ? reglas.reescribir(p) : null);

/* ---------- resolución ---------- */

async function archivoEstatico(pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(DIST, rel === '/' ? 'index.html' : rel);
  try {
    return { data: await readFile(file), tipo: TIPOS[extname(file)] || 'application/octet-stream' };
  } catch {
    return null;
  }
}

/** Qué función atiende una ruta ya reescrita. */
function funcionDe(pathname) {
  if (pathname === '/carta.json' && !VERCEL) return FUNCIONES.carta;
  const m = pathname.match(/^\/api\/([a-z]+)/);
  if (m && FUNCIONES[m[1]]) return FUNCIONES[m[1]];
  if (pathname.startsWith('/api/foto/')) return FUNCIONES.foto;
  return null;
}

async function ejecutar(cargar, url, req, chunks) {
  const mod = await cargar();
  const request = new Request(url.href, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)
  });
  return mod.default(request, {});
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const extra = VERCEL ? cabecerasDe(url.pathname) : {};
  const chunks = [];
  for await (const c of req) chunks.push(c);

  /* Vercel resuelve el sistema de archivos ANTES que las reescrituras; en
     Netlify una reescritura forzada gana al archivo. Emular el orden real es
     todo el sentido de este modo. */
  const estaticoPrimero = VERCEL ? await archivoEstatico(url.pathname) : null;
  if (estaticoPrimero) {
    res.writeHead(200, { 'content-type': estaticoPrimero.tipo, ...extra });
    res.end(estaticoPrimero.data);
    return;
  }

  const destino = VERCEL ? reescribir(url.pathname) : null;
  const rutaFinal = destino ? new URL(destino, url.origin) : url;
  if (destino) {
    for (const [k, v] of rutaFinal.searchParams) url.searchParams.set(k, v);
    url.pathname = rutaFinal.pathname;
  }

  const cargar = funcionDe(url.pathname);
  if (cargar) {
    try {
      const out = await ejecutar(cargar, url, req, chunks);
      const headers = { ...extra };
      out.headers.forEach((v, k) => (headers[k] = v));
      res.writeHead(out.status, headers);
      res.end(Buffer.from(await out.arrayBuffer()));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(err && err.message) }));
    }
    return;
  }

  const estatico = VERCEL ? null : await archivoEstatico(url.pathname);
  if (estatico) {
    res.writeHead(200, { 'content-type': estatico.tipo, ...extra });
    res.end(estatico.data);
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...extra });
  res.end('no encontrado');
});

const puerto = Number(process.argv[2] || process.env.PORT || 4321);
server.listen(puerto, () => {
  console.log(`modo    ${VERCEL ? 'Vercel' : 'Netlify'}`);
  console.log(`carta   http://127.0.0.1:${puerto}/`);
  console.log(`panel   http://127.0.0.1:${puerto}/admin.html`);
  console.log(`datos   ${DATA}`);
  if ((process.env.ADMIN_PASSWORD || '').length < 12) {
    console.log('aviso   ADMIN_PASSWORD ausente o de menos de 12 caracteres: el panel no dejará entrar');
  }
  if (VERCEL && !process.env.CARBOLITAS_TARGET) {
    console.log('aviso   compila con CARBOLITAS_TARGET=vercel npm run build antes de probar este modo');
  }
});
