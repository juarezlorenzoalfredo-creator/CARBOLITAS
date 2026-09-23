/**
 * Fotos de los platillos.
 *
 *   GET  /api/foto/<archivo>.webp  — sirve una foto subida desde el panel
 *   POST /api/foto                 — recibe una foto ya redimensionada
 *
 * El redimensionado y la codificación a WebP ocurren en el navegador del
 * panel: aquí no se procesa imagen, sólo se comprueba que lo que llega es
 * WebP, pequeño y con un nombre admisible. Así el servidor no necesita
 * librerías de imagen y no hay nada que explotar con un archivo manipulado.
 */
import { autorizado } from '../shared/auth.mjs';
import { guardarFoto, leerFoto } from '../shared/store.mjs';
import { cuerpo, error, json } from '../shared/http.mjs';

const NOMBRE_OK = new RegExp('^[a-z0-9][a-z0-9-]{0,39}-(\\d{2,4})\\.webp$');
const SLUG_OK = new RegExp('^[a-z0-9][a-z0-9-]{0,39}$');
const MAX_VARIANTES = 4;
const MAX_BYTES_FOTO = 400 * 1024;
const MAX_BYTES = 2 * 1024 * 1024;

/** Los cuatro primeros bytes son "RIFF" y los cuatro siguientes al tamaño, "WEBP". */
function esWebp(buf) {
  return (
    buf.length > 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  );
}

export default async (req) => {
  const ruta = new URL(req.url).pathname;

  if (req.method === 'GET') {
    const nombre = ruta.split('/').pop() || '';
    if (!NOMBRE_OK.test(nombre)) return error('Nombre de archivo no válido.', 400);
    const bytes = await leerFoto(nombre);
    if (!bytes) {
      /* Un poco de caché en el 404 evita que pedir nombres al azar cueste una
         invocación y una lectura por petición. */
      return error('Foto no encontrada.', 404, { 'cache-control': 'public, max-age=300' });
    }
    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': 'image/webp',
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff'
      }
    });
  }

  if (req.method !== 'POST') return error('Método no permitido.', 405);
  if (!(await autorizado(req))) return error('Sesión caducada. Vuelve a entrar.', 401);

  const { data, error: err } = await cuerpo(req, MAX_BYTES);
  if (err) return error(err);

  const slug = String(data?.slug || '');
  if (!SLUG_OK.test(slug)) return error('Nombre de foto no válido.', 400);

  const entradas = Array.isArray(data?.variants) ? data.variants.slice(0, MAX_VARIANTES) : [];
  if (!entradas.length) return error('No llegó ninguna imagen.', 400);

  const variants = [];
  for (const v of entradas) {
    const w = Number(v?.w);
    const h = Number(v?.h);
    if (!Number.isInteger(w) || w < 160 || w > 2048) return error('Ancho de imagen fuera de rango.');
    if (!Number.isInteger(h) || h < 120 || h > 2048) return error('Alto de imagen fuera de rango.');
    let bytes;
    try {
      bytes = Buffer.from(String(v?.data || ''), 'base64');
    } catch {
      return error('La imagen no se pudo decodificar.');
    }
    if (!bytes.length || bytes.length > MAX_BYTES_FOTO) return error('La imagen pesa demasiado.');
    if (!esWebp(bytes)) return error('Sólo se admiten imágenes WebP generadas por el panel.');
    const nombre = `${slug}-${w}.webp`;
    if (!NOMBRE_OK.test(nombre)) return error('Nombre de archivo no válido.', 400);
    try {
      await guardarFoto(nombre, bytes);
    } catch {
      return error('No se pudo guardar la foto. El almacén no está disponible.', 503);
    }
    variants.push({ w, h, src: `api/foto/${nombre}` });
  }

  variants.sort((a, b) => a.w - b.w);
  const mayor = variants[variants.length - 1];
  return json({
    ok: true,
    slug,
    entry: { ratio: Math.round((mayor.w / mayor.h) * 1e4) / 1e4, variants }
  });
};
