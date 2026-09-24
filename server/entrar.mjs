/**
 * POST /api/entrar — cambia la contraseña del sitio por un token temporal.
 * POST /api/entrar con { accion: 'salir' } y un token válido — apaga todos los
 *   tokens emitidos hasta ese momento.
 */
import { autorizado, crearToken, estadoPassword, passwordCorrecta, tokenDe } from './auth.mjs';
import { contarIntento, limpiarIntentos, revocarTodo } from './store.mjs';
import { cuerpo, error, huella, json } from './http.mjs';

const VENTANA_MS = 15 * 60 * 1000;
const MAX_INTENTOS = 8;

export default async (req) => {
  if (req.method !== 'POST') return error('Método no permitido.', 405);

  const config = estadoPassword();
  if (!config.ok) return error(config.motivo, 503);

  /* "Salir" llega con un pase en la cabecera y no gasta intentos: se atiende
     antes del freno, pero sólo si el pase es válido. */
  if (tokenDe(req)) {
    if (!(await autorizado(req))) return error('Sesión caducada.', 401);
    const { data } = await cuerpo(req, 4096);
    if (data?.accion === 'salir') {
      await revocarTodo();
      return json({ ok: true });
    }
    return error('Petición no reconocida.', 400);
  }

  /* El intento se cuenta ANTES de leer el cuerpo y ANTES de mirar la
     contraseña: así una petición anónima no puede hacer que el servidor
     almacene megabytes, ni probar claves sin que nadie lleve la cuenta. */
  const marca = huella(req);
  if (!marca) {
    return error('No se pudo identificar el origen de la petición. Inténtalo de nuevo.', 503);
  }
  const intento = await contarIntento(marca, VENTANA_MS, MAX_INTENTOS);
  if (!intento.disponible) {
    return error('El sistema de acceso no está disponible ahora mismo. Inténtalo en un minuto.', 503);
  }
  if (intento.bloqueado) {
    return error('Demasiados intentos. Espera unos minutos y vuelve a probar.', 429);
  }

  const { data, error: err } = await cuerpo(req, 4096);
  if (err) return error(err);

  if (!passwordCorrecta(data?.password)) return error('Contraseña incorrecta.', 401);

  const sesion = await crearToken();
  if (!sesion) {
    return error('No se pudo abrir la sesión: el almacén del sitio no responde.', 503);
  }
  await limpiarIntentos(marca);
  return json({ ok: true, token: sesion.token, expira: sesion.expira });
};
