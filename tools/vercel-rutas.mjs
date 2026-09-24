/**
 * Las reglas de enrutado de vercel.json, aplicables desde Node.
 *
 * Existe para poder comprobar el despliegue de Vercel sin desplegarlo: el
 * servidor de desarrollo y el QA leen el mismo archivo que leerá Vercel y
 * respetan su orden de resolución —los archivos se consultan ANTES que las
 * reescrituras, al revés que en Netlify—.
 */
import { readFileSync } from 'node:fs';

/**
 * Convierte un `source` de vercel.json en una expresión regular.
 *
 * Vercel admite dos cosas mezcladas: parámetros `:nombre` y grupos entre
 * paréntesis que ya son expresión regular —`/(.*)`, `/(admin|otro).html`—.
 * Lo que va entre paréntesis se deja tal cual; el resto se escapa.
 */
export function aRegExp(patron) {
  const nombres = [];
  let cuerpo = '';
  let resto = patron;
  while (resto.length) {
    const abre = resto.indexOf('(');
    const literal = abre === -1 ? resto : resto.slice(0, abre);
    cuerpo += literal
      .replace(/[.+?^${}|[\]\\]/g, '\\$&')
      .replace(/:(\w+)\*/g, (_, n) => (nombres.push(n), '(.*)'))
      .replace(/:(\w+)/g, (_, n) => (nombres.push(n), '([^/]+)'));
    if (abre === -1) break;
    const cierra = resto.indexOf(')', abre);
    if (cierra === -1) {
      cuerpo += '\\(';
      resto = resto.slice(abre + 1);
      continue;
    }
    cuerpo += resto.slice(abre, cierra + 1);
    nombres.push(String(nombres.length));
    resto = resto.slice(cierra + 1);
  }
  return { re: new RegExp(`^${cuerpo}$`), nombres };
}

/** @param {string} archivo ruta a vercel.json */
export function cargarReglas(archivo) {
  const conf = JSON.parse(readFileSync(archivo, 'utf8'));
  const reescrituras = (conf.rewrites || []).map((r) => ({ ...r, ...aRegExp(r.source) }));
  const cabeceras = (conf.headers || []).map((h) => ({ ...h, ...aRegExp(h.source) }));

  return {
    conf,
    /** Todas las cabeceras que Vercel añadiría a esta ruta. */
    cabecerasDe(pathname) {
      const out = {};
      for (const regla of cabeceras) {
        if (regla.re.test(pathname)) for (const { key, value } of regla.headers) out[key] = value;
      }
      return out;
    },
    /** Ruta de destino si alguna reescritura aplica, o null. */
    reescribir(pathname) {
      for (const regla of reescrituras) {
        const m = pathname.match(regla.re);
        if (!m) continue;
        let destino = regla.destination;
        regla.nombres.forEach((n, i) => {
          destino = destino.replace(`:${n}`, encodeURIComponent(m[i + 1]));
        });
        return destino;
      }
      return null;
    }
  };
}
