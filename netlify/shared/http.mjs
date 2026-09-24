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
 * Identificador de quien llama, sólo para limitar intentos.
 *
 * Se usa únicamente la cabecera que pone la plataforma. X-Forwarded-For la
 * escribe el cliente en su primer tramo, así que confiar en ella permitiría
 * elegirse un cubo de conteo distinto en cada intento. Sin cabecera de
 * plataforma todos comparten un mismo cubo: se cuenta de más, nunca de menos.
 */
export function huella(req) {
  const ip = req.headers.get('x-nf-client-connection-ip') || 'sin-origen';
  return Buffer.from(ip).toString('hex').slice(0, 40);
}
