/** Respuestas uniformes para todas las funciones. */

const BASE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin'
};

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...BASE, ...extra } });
}

export function error(mensaje, status = 400, extra = {}) {
  return json({ ok: false, error: mensaje }, status, extra);
}

/** Cuerpo JSON acotado: un cuerpo enorme se rechaza antes de parsearlo. */
export async function cuerpo(req, maxBytes) {
  const largo = Number(req.headers.get('content-length') || 0);
  if (largo > maxBytes) return { error: 'El contenido es demasiado grande.' };
  let texto;
  try {
    texto = await req.text();
  } catch {
    return { error: 'No se pudo leer el contenido.' };
  }
  /* .length cuenta unidades UTF-16: un texto con acentos pesa más bytes de
     los que aparenta, así que el tope se mide sobre los bytes reales. */
  if (Buffer.byteLength(texto, 'utf8') > maxBytes)
    return { error: 'El contenido es demasiado grande.' };
  try {
    return { data: JSON.parse(texto) };
  } catch {
    return { error: 'El contenido no es JSON válido.' };
  }
}

/**
 * Identificador de quien llama, sólo para limitar intentos de contraseña.
 *
 * Tiene que venir de la plataforma, nunca del cliente. Las dos sobrescriben su
 * propia cabecera antes de entregar la petición —Vercel lo documenta como
 * medida contra la suplantación de IP— así que quien llama no puede elegirse
 * un cubo de conteo distinto en cada intento y saltarse el freno.
 *
 * Fuera de una plataforma (pruebas, `npm run dev`) se usa un cubo único: se
 * cuenta de más, nunca de menos.
 *
 * @returns {string|null} null = no se pudo identificar el origen en una
 *   plataforma real; quien llama debe cerrar la puerta, no abrirla.
 */
export function huella(req) {
  const h = (n) => (req.headers.get(n) || '').split(',').pop().trim();
  let ip = '';
  if (process.env.VERCEL) {
    /* x-vercel-forwarded-for sobrevive incluso con un proxy delante. */
    ip = h('x-vercel-forwarded-for') || h('x-real-ip') || h('x-forwarded-for');
  } else if (process.env.NETLIFY) {
    ip = h('x-nf-client-connection-ip');
  } else {
    return 'desarrollo';
  }
  if (!ip) return null;
  return Buffer.from(ip).toString('hex').slice(0, 40);
}
