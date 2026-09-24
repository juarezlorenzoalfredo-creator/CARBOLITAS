/**
 * Almacén de la carta publicada, de las fotos y de los datos de acceso.
 *
 * El mismo código corre en Netlify y en Vercel; lo único que cambia es dónde
 * se guardan los bytes. El driver se elige solo, por las variables que cada
 * plataforma pone en el entorno, y se puede sustituir por uno en memoria para
 * las pruebas y el servidor de desarrollo.
 *
 * Contrato que cumplen los tres drivers (server/drivers/*.mjs):
 *
 *   leerTexto(clave)      → string | null
 *   leerJSON(clave)       → any | null
 *   leerBytes(clave)      → ArrayBuffer | Buffer | null
 *   escribir(clave, val)  → void, LANZA si no se pudo escribir
 *   borrar(clave)         → void
 *   listar(prefijo)       → string[] (claves completas, todas las páginas)
 *
 * Deliberadamente no hay "escribe sólo si no existe": Netlify Blobs no tiene
 * esa operación, y fingirla con leer-y-escribir habría dado un candado que
 * parece atómico y no lo es. El contador de intentos no la necesita porque
 * cada intento escribe su propia clave única.
 */
import { randomBytes } from 'node:crypto';

export const CLAVE_CARTA = 'carta.json';
const CLAVE_SECRETO = 'acceso/secreto';
const CLAVE_REVOCACION = 'acceso/revocados-desde';

let driver;
let intentado = false;

async function cargar() {
  /* El sustituto de las pruebas se consulta en cada llamada, no se memoriza:
     cambian de almacén entre casos y el módulo es único en el proceso. */
  const inyectado = globalThis.__CARBOLITAS_STORE__;
  if (inyectado) {
    return (await inyectado.disponible?.()) === false ? null : inyectado;
  }
  if (intentado) return driver;
  intentado = true;
  try {
    if (process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN) {
      driver = (await import('./drivers/vercel.mjs')).crear();
    } else {
      driver = (await import('./drivers/netlify.mjs')).crear();
    }
  } catch {
    driver = null;
  }
  if (driver && typeof driver.disponible === 'function' && !(await driver.disponible())) {
    driver = null;
  }
  return driver;
}

export async function hayAlmacen() {
  return Boolean(await cargar());
}

/* ---------- la carta ---------- */

export async function leerCarta() {
  const d = await cargar();
  if (!d) return null;
  try {
    return await d.leerJSON(CLAVE_CARTA);
  } catch {
    return null;
  }
}

export async function guardarCarta(doc) {
  const d = await cargar();
  if (!d) throw new Error('almacen-no-disponible');
  await d.escribir(CLAVE_CARTA, JSON.stringify(doc));
}

/* ---------- fotos ---------- */

export async function leerFoto(nombre) {
  const d = await cargar();
  if (!d) return null;
  try {
    return await d.leerBytes(`foto/${nombre}`);
  } catch {
    return null;
  }
}

export async function guardarFoto(nombre, bytes) {
  const d = await cargar();
  if (!d) throw new Error('almacen-no-disponible');
  await d.escribir(`foto/${nombre}`, bytes);
}

/* ---------- secreto de firma ----------
   La clave con la que se firman los pases NO es la contraseña. Si lo fuera,
   cualquier pase capturado serviría para probar contraseñas sin conexión, a
   millones por segundo. Se genera un secreto aleatorio la primera vez y se
   guarda; ADMIN_SECRET lo sustituye si prefieres fijarlo tú. */
export const MIN_SECRETO = 32;

export async function secretoDeFirma() {
  const puesto = process.env.ADMIN_SECRET || '';
  /* Un ADMIN_SECRET corto sería peor que no ponerlo: quien capturara un pase
     podría sacarlo a fuerza bruta y emitir pases sin saber la contraseña. Si
     no llega al mínimo se ignora y se usa el secreto generado. */
  if (puesto.length >= MIN_SECRETO) return `env::${puesto}`;

  const d = await cargar();
  if (!d) return null;
  try {
    const guardado = await d.leerTexto(CLAVE_SECRETO);
    if (guardado && guardado.length >= MIN_SECRETO) return guardado;
    const nuevo = randomBytes(32).toString('hex');
    await d.escribir(CLAVE_SECRETO, nuevo);
    /* Se relee: si dos arranques en frío lo crearon a la vez, los dos acaban
       usando el que quedó escrito y ningún pase se invalida. */
    return (await d.leerTexto(CLAVE_SECRETO)) || nuevo;
  } catch {
    return null;
  }
}

/* ---------- revocación ----------
   "Salir" tiene que apagar de verdad el pase, no sólo borrarlo de la
   pantalla: el panel se usa desde teléfonos prestados. */

/**
 * @returns {Promise<number|null>} marca de la última revocación, 0 si nunca se
 *   ha revocado, y null si no se pudo leer. Distinguir los dos últimos casos
 *   importa: tratar un fallo de lectura como "nunca se revocó" resucitaría
 *   los pases que la dueña acaba de apagar al tocar "Salir".
 */
export async function revocadosDesde() {
  const d = await cargar();
  if (!d) return null;
  try {
    const valor = await d.leerTexto(CLAVE_REVOCACION);
    if (valor === null) return 0;
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function revocarTodo() {
  const d = await cargar();
  if (!d) return false;
  try {
    await d.escribir(CLAVE_REVOCACION, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/* ---------- freno a los intentos de contraseña ----------
   Cada intento deja su propia marca con una clave única y se cuentan las
   marcas vivas. Así no hay "leer, sumar uno, escribir": sesenta peticiones
   simultáneas dejan sesenta marcas, no una. */

const marcaUnica = () => `${Date.now()}-${randomBytes(6).toString('hex')}`;

/** Tope de marcas por cubo: evita que insistir sin parar engorde el almacén. */
const MAX_MARCAS = 32;

/**
 * @returns {Promise<{bloqueado:boolean, n:number, disponible:boolean}>}
 *   disponible=false significa que no se pudo contar; quien llama debe
 *   cerrar la puerta, no abrirla.
 */
export async function contarIntento(clave, ventanaMs, max) {
  const d = await cargar();
  if (!d) return { bloqueado: true, n: max, disponible: false };
  const prefijo = `intentos/${clave}/`;
  const ahora = Date.now();
  try {
    /* Primero la marca, luego la cuenta. Al revés, dos intentos simultáneos
       leerían cero los dos y pasarían los dos. Si la escritura falla, esto
       lanza y se cierra la puerta: un almacén que no admite escrituras no
       puede llevar la cuenta, y sin cuenta no se prueban contraseñas. */
    await d.escribir(`${prefijo}${marcaUnica()}`, '1');

    const claves = await d.listar(prefijo);
    let vivas = 0;
    const sobrantes = [];
    for (const k of claves) {
      const sello = Number(k.slice(prefijo.length).split('-')[0]);
      if (Number.isFinite(sello) && ahora - sello < ventanaMs) vivas += 1;
      /* Las marcas caducadas se van borrando solas al pasar por aquí: nadie
         tiene que acordarse de limpiar. */
      else sobrantes.push(k);
    }
    for (const k of sobrantes) d.borrar(k).catch(() => {});

    /* Ya bloqueado y con el cubo lleno: se deja de acumular. La cuenta no
       baja, porque lo que decide es el número de marcas vivas. */
    if (claves.length > MAX_MARCAS) {
      const extra = claves.slice(MAX_MARCAS);
      for (const k of extra) d.borrar(k).catch(() => {});
    }

    return { bloqueado: vivas > max, n: vivas, disponible: true };
  } catch {
    return { bloqueado: true, n: max, disponible: false };
  }
}

export async function limpiarIntentos(clave) {
  const d = await cargar();
  if (!d) return;
  try {
    const claves = await d.listar(`intentos/${clave}/`);
    await Promise.all(claves.map((k) => d.borrar(k).catch(() => {})));
  } catch {
    /* nada que limpiar */
  }
}
