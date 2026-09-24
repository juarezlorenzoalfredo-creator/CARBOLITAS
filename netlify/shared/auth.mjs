/**
 * Acceso al panel.
 *
 * La contraseña vive en una variable de entorno del sitio, nunca en el código
 * ni en el navegador. El panel la cambia por un token firmado con caducidad;
 * a partir de ahí sólo viaja el token.
 *
 * El token se firma con un secreto aleatorio del sitio, NO con la contraseña.
 * Si se firmara con la contraseña, un token capturado (una extensión del
 * navegador, una pantalla compartida, un proxy corporativo) permitiría probar
 * contraseñas sin conexión a millones por segundo. Con un secreto propio, un
 * token filtrado sólo vale hasta que caduca o hasta que se toca "Salir".
 */
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { revocadosDesde, secretoDeFirma } from './store.mjs';

const HORAS = 8;

/** Longitud mínima exigida a ADMIN_PASSWORD. */
export const MIN_PASSWORD = 12;

const b64u = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const firma = (payload, key) => b64u(createHmac('sha256', key).update(payload).digest());

/** Comparación en tiempo constante: no filtra por cuánto tarda en fallar. */
function igual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/**
 * Estado de la configuración del panel, para poder explicar al administrador
 * qué le falta en lugar de dejarlo con un "no entra" a secas.
 * @returns {{ok:boolean, motivo:string}}
 */
export function estadoPassword() {
  const pass = process.env.ADMIN_PASSWORD || '';
  /* El motivo es el mismo tanto si falta la contraseña como si es corta: a un
     desconocido no hay que contarle que este sitio usa una clave débil, y a
     quien administra el sitio le sirve igual para saber qué revisar. */
  const motivo =
    `El panel no está disponible. Si administras el sitio, revisa en Netlify (Site configuration → Environment variables) que ADMIN_PASSWORD exista y tenga al menos ${MIN_PASSWORD} caracteres.`;
  if (!pass || pass.length < MIN_PASSWORD) return { ok: false, motivo };
  return { ok: true, motivo: '' };
}

export function passwordConfigurada() {
  return estadoPassword().ok;
}

/** @returns {boolean} */
export function passwordCorrecta(intento) {
  if (!estadoPassword().ok) return false;
  const real = process.env.ADMIN_PASSWORD || '';
  /* Se comparan los HMAC y no las cadenas: así la comparación es de longitud
     fija y no revela ni siquiera cuántos caracteres tiene la contraseña. */
  const key = 'longitud-fija';
  return igual(
    createHmac('sha256', key).update(String(intento ?? '')).digest('hex'),
    createHmac('sha256', key).update(real).digest('hex')
  );
}

/**
 * Marca de la contraseña vigente. Va dentro del token para que cambiarla
 * invalide los tokens emitidos antes. No es un oráculo: sin el secreto del
 * sitio no se puede calcular para una contraseña candidata.
 */
const marcaPassword = (key) =>
  createHmac('sha256', key).update(`pv::${process.env.ADMIN_PASSWORD || ''}`).digest('hex').slice(0, 16);

/** @returns {Promise<{token:string, expira:number}|null>} null si no hay secreto. */
export async function crearToken() {
  const key = await secretoDeFirma();
  if (!key || !estadoPassword().ok) return null;
  const ahora = Date.now();
  const expira = ahora + HORAS * 3600 * 1000;
  const payload = b64u(
    JSON.stringify({ exp: expira, iat: ahora, jti: randomUUID(), pv: marcaPassword(key) })
  );
  return { token: `${payload}.${firma(payload, key)}`, expira };
}

/** @returns {Promise<boolean>} firma válida, sin caducar, no revocado. */
export async function tokenValido(token) {
  if (typeof token !== 'string' || !estadoPassword().ok) return false;
  const key = await secretoDeFirma();
  if (!key) return false;
  const corte = token.indexOf('.');
  if (corte < 1) return false;
  const payload = token.slice(0, corte);
  /* La firma se comprueba antes de mirar el contenido. */
  if (!igual(token.slice(corte + 1), firma(payload, key))) return false;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  } catch {
    return false;
  }
  if (!(Number(data.exp) > Date.now())) return false;
  if (data.pv !== marcaPassword(key)) return false;
  const corteRevocacion = await revocadosDesde();
  if (corteRevocacion && !(Number(data.iat) > corteRevocacion)) return false;
  return true;
}

/** Token del encabezado Authorization: Bearer … */
export function tokenDe(req) {
  const raw = req.headers.get('authorization') || '';
  return raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
}

export function autorizado(req) {
  return tokenValido(tokenDe(req));
}
