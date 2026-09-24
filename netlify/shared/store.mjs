/**
 * Almacén de la carta publicada, de las fotos subidas y de los datos de
 * acceso.
 *
 * Usa Netlify Blobs: viene con el propio sitio, así que no hay que crear
 * cuentas ni bases de datos aparte. Si el almacén no está disponible, las
 * lecturas devuelven null y la carta cae a lo compilado — pero las funciones
 * que protegen el panel se cierran en lugar de abrirse (ver `contarIntento`).
 */
import { randomBytes } from 'node:crypto';

const NOMBRE = 'carbolitas';
export const CLAVE_CARTA = 'carta.json';
const CLAVE_SECRETO = 'acceso/secreto';
const CLAVE_REVOCACION = 'acceso/revocados-desde';

/* El paquete se carga en caliente: en Netlify viene con el sitio, y en el
   servidor de desarrollo de tools/dev.mjs se sustituye por una carpeta local.
   Si no hay ninguno de los dos, el almacén simplemente no existe. */
let fabrica;
async function cargar() {
  /* El sustituto se consulta en cada llamada, no se memoriza: las pruebas
     cambian de almacén entre casos y el módulo es único en el proceso. */
  if (globalThis.__CARBOLITAS_BLOBS__) return globalThis.__CARBOLITAS_BLOBS__;
  if (fabrica !== undefined) return fabrica;
  try {
    const mod = await import('@netlify/blobs');
    fabrica = mod.getStore;
  } catch {
    fabrica = null;
  }
  return fabrica;
}

async function almacen() {
  const getStore = await cargar();
  if (!getStore) return null;
  try {
    return getStore({ name: NOMBRE, consistency: 'strong' });
  } catch {
    return null;
  }
}

export async function hayAlmacen() {
  return Boolean(await almacen());
}

/* ---------- la carta ---------- */

export async function leerCarta() {
  const s = await almacen();
  if (!s) return null;
  try {
    return await s.get(CLAVE_CARTA, { type: 'json' });
  } catch {
    return null;
  }
}

export async function guardarCarta(doc) {
  const s = await almacen();
  if (!s) throw new Error('almacen-no-disponible');
  await s.setJSON(CLAVE_CARTA, doc);
}

/* ---------- fotos ---------- */

export async function leerFoto(nombre) {
  const s = await almacen();
  if (!s) return null;
  try {
    return await s.get(`foto/${nombre}`, { type: 'arrayBuffer' });
  } catch {
    return null;
  }
}

export async function guardarFoto(nombre, bytes) {
  const s = await almacen();
  if (!s) throw new Error('almacen-no-disponible');
  await s.set(`foto/${nombre}`, bytes);
}

/* ---------- secreto de firma ----------
   La clave con la que se firman los tokens NO es la contraseña. Si lo fuera,
   cualquier token capturado serviría para probar contraseñas sin conexión, a
   millones por segundo. Aquí se genera un secreto aleatorio la primera vez y
   se guarda; ADMIN_SECRET lo sustituye si prefieres fijarlo tú. */
export async function secretoDeFirma() {
  if (process.env.ADMIN_SECRET) return `env::${process.env.ADMIN_SECRET}`;
  const s = await almacen();
  if (!s) return null;
  try {
    const guardado = await s.get(CLAVE_SECRETO, { type: 'text' });
    if (guardado && guardado.length >= 32) return guardado;
    const nuevo = randomBytes(32).toString('hex');
    await s.set(CLAVE_SECRETO, nuevo);
    /* Se relee: si dos invocaciones lo crearon a la vez, gana la que quedó. */
    return (await s.get(CLAVE_SECRETO, { type: 'text' })) || nuevo;
  } catch {
    return null;
  }
}

/* ---------- revocación ----------
   "Salir" tiene que apagar de verdad el token, no sólo borrarlo de la
   pantalla: el panel se usa desde teléfonos prestados. */

export async function revocadosDesde() {
  const s = await almacen();
  if (!s) return 0;
  try {
    return Number(await s.get(CLAVE_REVOCACION, { type: 'text' })) || 0;
  } catch {
    return 0;
  }
}

export async function revocarTodo() {
  const s = await almacen();
  if (!s) return false;
  try {
    await s.set(CLAVE_REVOCACION, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/* ---------- freno a los intentos de contraseña ----------
   Se cuenta ANTES de comprobar la contraseña y con escritura condicionada a
   la versión leída: si dos intentos entran a la vez, uno de los dos reintenta
   en lugar de pisar la cuenta del otro. Sin esta condición, lanzar sesenta
   peticiones en paralelo dejaba el contador en 1. */

/**
 * @returns {Promise<{bloqueado:boolean, n:number, disponible:boolean}>}
 *   disponible=false significa que no se pudo contar; quien llama debe
 *   cerrar la puerta, no abrirla.
 */
export async function contarIntento(clave, ventanaMs, max) {
  const s = await almacen();
  if (!s) return { bloqueado: true, n: max, disponible: false };
  const key = `intentos/${clave}`;

  for (let intento = 0; intento < 6; intento += 1) {
    let actual = null;
    let etag;
    try {
      if (typeof s.getWithMetadata === 'function') {
        const r = await s.getWithMetadata(key, { type: 'json' });
        actual = r?.data ?? null;
        etag = r?.etag;
      } else {
        actual = await s.get(key, { type: 'json' });
      }
    } catch {
      return { bloqueado: true, n: max, disponible: false };
    }

    const ahora = Date.now();
    const vivo = actual && ahora - actual.desde < ventanaMs ? actual : { desde: ahora, n: 0 };
    const siguiente = { desde: vivo.desde, n: vivo.n + 1 };

    try {
      if (etag !== undefined) await s.setJSON(key, siguiente, { onlyIfMatch: etag });
      else if (actual === null && typeof s.setJSON === 'function')
        await s.setJSON(key, siguiente, { onlyIfNew: true });
      else await s.setJSON(key, siguiente);
      return { bloqueado: siguiente.n > max, n: siguiente.n, disponible: true };
    } catch (err) {
      /* Escritura condicionada que perdió la carrera: se vuelve a leer. */
      if (intento === 5) return { bloqueado: true, n: max, disponible: false };
    }
  }
  return { bloqueado: true, n: max, disponible: false };
}

export async function limpiarIntentos(clave) {
  const s = await almacen();
  if (!s) return;
  try {
    await s.delete(`intentos/${clave}`);
  } catch {
    /* nada que limpiar */
  }
}
