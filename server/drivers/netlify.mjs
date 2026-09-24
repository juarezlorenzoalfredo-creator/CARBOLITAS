/**
 * Almacén sobre Netlify Blobs.
 *
 * Viene con el propio sitio: no hay que crear cuentas ni bases de datos
 * aparte. El paquete se carga en caliente para que este archivo no rompa el
 * despliegue en una plataforma donde no existe.
 */

const NOMBRE = 'carbolitas';

let store;
async function abrir() {
  if (store !== undefined) return store;
  try {
    const { getStore } = await import('@netlify/blobs');
    store = getStore({ name: NOMBRE, consistency: 'strong' });
  } catch {
    store = null;
  }
  return store;
}

const texto = (valor) => (typeof valor === 'string' ? valor : String(valor));

export function crear() {
  return {
    async disponible() {
      return Boolean(await abrir());
    },
    async leerTexto(clave) {
      const s = await abrir();
      return s ? await s.get(clave, { type: 'text' }) : null;
    },
    async leerJSON(clave) {
      const s = await abrir();
      return s ? await s.get(clave, { type: 'json' }) : null;
    },
    async leerBytes(clave) {
      const s = await abrir();
      return s ? await s.get(clave, { type: 'arrayBuffer' }) : null;
    },
    async escribir(clave, valor) {
      const s = await abrir();
      if (!s) throw new Error('sin almacén');
      await s.set(clave, Buffer.isBuffer(valor) ? valor : texto(valor));
    },
    async borrar(clave) {
      const s = await abrir();
      if (s) await s.delete(clave);
    },
    async listar(prefijo) {
      const s = await abrir();
      if (!s) return [];
      const { blobs } = await s.list({ prefix: prefijo });
      return (blobs || []).map((b) => b.key);
    }
  };
}
