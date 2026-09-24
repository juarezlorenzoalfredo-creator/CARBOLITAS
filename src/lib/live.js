/**
 * Puente con la carta publicada desde el panel.
 *
 * Todo aquí es opcional por diseño: si el sitio se subió como archivos
 * estáticos (sin funciones), estas llamadas fallan en silencio y la carta
 * sigue mostrando lo que se compiló. Nunca se bloquea la primera pintura
 * esperando a la red.
 */

export const API_BASE = 'api/';

/**
 * Una sola dirección para las dos formas de publicar:
 *  - sitio estático  → carta.json es el archivo que dejó el build (o el que
 *    descargaste del panel y volviste a subir);
 *  - sitio con panel → Netlify reescribe esta ruta a la función y devuelve la
 *    carta vigente.
 * Así nunca hay un 404 en la consola del cliente.
 */
export const CARTA_URL = 'carta.json';

/** @returns {Promise<any|null>} documento publicado, o null si no se pudo leer. */
export async function fetchCarta(timeoutMs = 6000) {
  if (typeof fetch !== 'function') return null;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const corte = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : 0;
  try {
    const res = await fetch(CARTA_URL, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object') return null;
    return Array.isArray(data.products) ? data : Array.isArray(data.doc?.products) ? data.doc : null;
  } catch {
    return null;
  } finally {
    if (corte) clearTimeout(corte);
  }
}

/** Teléfono a 10 dígitos en grupos legibles: 4471257475 → "447 125 7475". */
export function prettyPhone(phone) {
  return String(phone || '').replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3');
}
