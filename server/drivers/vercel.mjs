/**
 * Almacén sobre Vercel Blob.
 *
 * Todo se guarda con `access: 'private'`: el secreto de firma y el contador
 * de intentos no pueden quedar en una URL pública, y las fotos se sirven por
 * nuestra propia función, así que tampoco necesitan una.
 *
 * `put(..., { allowOverwrite: false })` falla si la clave ya existe, y eso es
 * justo la escritura condicional que necesita el contador de intentos para no
 * perder cuentas cuando entran varias peticiones a la vez.
 */

let sdk;
async function api() {
  if (sdk !== undefined) return sdk;
  try {
    sdk = await import('@vercel/blob');
  } catch {
    sdk = null;
  }
  return sdk;
}

const PRIVADO = { access: 'private', addRandomSuffix: false };

/* Sin caché, en los dos sentidos.
   Vercel Blob sirve las lecturas por CDN y las escrituras se anuncian con 30
   días de caché por defecto. Aquí eso sería un agujero: tras tocar "Salir",
   una lectura cacheada de la marca de revocación devolvería el valor anterior
   y el pase apagado volvería a valer; y el secreto de firma podría leerse
   como ausente en un arranque en frío y regenerarse, tirando todas las
   sesiones. Nada de lo que guardamos es grande ni se lee mucho. */
const SIN_CACHE = { useCache: false };
const NO_CACHEAR = { cacheControlMaxAge: 0 };

async function leer(clave) {
  const b = await api();
  if (!b) return null;
  try {
    const r = await b.get(clave, { access: 'private', ...SIN_CACHE });
    if (!r || (r.statusCode && r.statusCode !== 200)) return null;
    return r;
  } catch {
    /* Vercel Blob lanza cuando la clave no existe: no encontrarla no es un
       error del que haya que enterarse. */
    return null;
  }
}

export function crear() {
  return {
    async disponible() {
      return Boolean(await api());
    },
    async leerTexto(clave) {
      const r = await leer(clave);
      if (!r) return null;
      return new Response(r.stream ?? r.body).text();
    },
    async leerJSON(clave) {
      const t = await this.leerTexto(clave);
      if (t === null) return null;
      try {
        return JSON.parse(t);
      } catch {
        return null;
      }
    },
    async leerBytes(clave) {
      const r = await leer(clave);
      if (!r) return null;
      return new Response(r.stream ?? r.body).arrayBuffer();
    },
    async escribir(clave, valor) {
      const b = await api();
      if (!b) throw new Error('sin almacén');
      await b.put(clave, valor, { ...PRIVADO, ...NO_CACHEAR, allowOverwrite: true });
    },
    async borrar(clave) {
      const b = await api();
      if (b) await b.del(clave, { access: 'private' });
    },
    async listar(prefijo) {
      const b = await api();
      if (!b) return [];
      /* Se recorren todas las páginas: quedarse en la primera haría que las
         marcas caducadas del final no se limpiaran nunca. */
      const out = [];
      let cursor;
      for (let pagina = 0; pagina < 20; pagina += 1) {
        const r = await b.list({ prefix: prefijo, access: 'private', limit: 500, cursor });
        for (const x of r.blobs || []) out.push(x.pathname);
        if (!r.hasMore || !r.cursor) break;
        cursor = r.cursor;
      }
      return out;
    }
  };
}
