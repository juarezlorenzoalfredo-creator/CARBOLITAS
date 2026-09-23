/**
 * POST /api/entrar — cambia la contraseña del sitio por un token temporal.
 * POST /api/entrar con { accion: 'salir' } y un token válido — apaga todos los
 *   tokens emitidos hasta ese momento.
 */
import { autorizado, crearToken, estadoPassword, passwordCorrecta } from '../shared/auth.mjs';
import { contarIntento, limpiarIntentos, revocarTodo } from '../shared/store.mjs';
import { cuerpo, error, huella, json } from '../shared/http.mjs';

const VENTANA_MS = 15 * 60 * 1000;
const MAX_INTENTOS = 8;

export default async (req) => {
  if (req.method !== 'POST') return error('Método no permitido.', 405);

  const config = estadoPassword();
  if (!config.ok) return error(config.motivo, 503);

  const { data, error: err } = await cuerpo(req, 4096);
  if (err) return error(err);

  if (data?.accion === 'salir') {
    if (!(await autorizado(req))) return error('Sesión caducada.', 401);
    await revocarTodo();
    return json({ ok: true });
  }

  /* Se cuenta el intento ANTES de mirar la contraseña, y con escritura
     condicionada: así sesenta peticiones simultáneas no se pisan la cuenta
     entre ellas. Si no se puede contar, no se comprueba nada: sin freno, el
     panel quedaría expuesto a prueba y error sin límite. */
  const intento = await contarIntento(huella(req), VENTANA_MS, MAX_INTENTOS);
  if (!intento.disponible) {
    return error('El sistema de acceso no está disponible ahora mismo. Inténtalo en un minuto.', 503);
  }
  if (intento.bloqueado) {
    return error('Demasiados intentos. Espera unos minutos y vuelve a probar.', 429);
  }

  if (!passwordCorrecta(data?.password)) return error('Contraseña incorrecta.', 401);

  const sesion = await crearToken();
  if (!sesion) {
    return error('No se pudo abrir la sesión: el almacén del sitio no responde.', 503);
  }
  await limpiarIntentos(huella(req));
  return json({ ok: true, token: sesion.token, expira: sesion.expira });
};
