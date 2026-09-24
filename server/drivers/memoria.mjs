/**
 * Almacén para pruebas y para el servidor de desarrollo.
 *
 * Cumple el mismo contrato que los drivers de Netlify y Vercel, así que las
 * funciones que se prueban aquí son exactamente las que se despliegan. Con
 * `dir` guarda en disco (sobrevive a reiniciar `npm run dev`); sin `dir`, todo
 * vive en memoria y desaparece al terminar el proceso.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const seguro = (clave) => clave.replace(/[^A-Za-z0-9._/-]/g, '_');

export function crear({ dir } = {}) {
  const memoria = new Map();

  const ruta = (clave) => join(dir, seguro(clave));

  const leerBuf = (clave) => {
    if (dir) {
      const f = ruta(clave);
      return existsSync(f) ? readFileSync(f) : null;
    }
    return memoria.has(clave) ? memoria.get(clave) : null;
  };

  const escribirBuf = (clave, buf) => {
    if (dir) {
      const f = ruta(clave);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, buf);
    } else {
      memoria.set(clave, buf);
    }
  };

  return {
    async disponible() {
      return true;
    },
    async leerTexto(clave) {
      const b = leerBuf(clave);
      return b === null ? null : b.toString('utf8');
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
      const b = leerBuf(clave);
      if (b === null) return null;
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
    async escribir(clave, valor) {
      escribirBuf(clave, Buffer.isBuffer(valor) ? valor : Buffer.from(String(valor)));
    },
    async borrar(clave) {
      if (dir) rmSync(ruta(clave), { force: true });
      else memoria.delete(clave);
    },
    async listar(prefijo) {
      if (!dir) return [...memoria.keys()].filter((k) => k.startsWith(prefijo));
      const base = join(dir, seguro(prefijo));
      const carpeta = prefijo.endsWith('/') ? base : dirname(base);
      if (!existsSync(carpeta)) return [];
      return readdirSync(carpeta)
        .map((n) => `${prefijo}${n}`)
        .filter((k) => k.startsWith(prefijo));
    }
  };
}
