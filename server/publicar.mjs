/**
 * POST /api/publicar — guarda la carta que envía el panel.
 *
 * Lo que llega del navegador nunca se guarda tal cual: se vuelve a construir
 * con normalizeDoc, el mismo validador que usa el build. Si el panel tuviera
 * un fallo, o alguien enviara el JSON a mano, lo que entra al almacén sigue
 * siendo una carta bien formada.
 */
import { autorizado } from './auth.mjs';
import { guardarCarta, leerCarta } from './store.mjs';
import { cuerpo, error, json } from './http.mjs';
import { normalizeDoc } from '../src/lib/document.js';
import { SLUGS } from './slugs.mjs';

const MAX_BYTES = 512 * 1024;

export default async (req) => {
  if (req.method !== 'POST') return error('Método no permitido.', 405);
  if (!(await autorizado(req))) return error('Sesión caducada. Vuelve a entrar.', 401);

  const { data, error: err } = await cuerpo(req, MAX_BYTES);
  if (err) return error(err);

  const entrante = data && data.doc ? data.doc : data;
  const { doc, errors } = normalizeDoc(entrante, { images: SLUGS });

  if (!doc.products.length) {
    return error('La carta se quedaría sin ningún platillo. No se publicó nada.', 422);
  }
  if (!doc.categories.length) {
    return error('La carta se quedaría sin categorías. No se publicó nada.', 422);
  }

  /* La hora de publicación la pone el servidor: es lo que el cliente compara
     para saber si tiene que repintar, y no puede depender del reloj del panel. */
  doc.updatedAt = new Date().toISOString();

  try {
    await guardarCarta(doc);
  } catch {
    return error(
      'No se pudo guardar. El almacén del sitio no está disponible en este despliegue.',
      503
    );
  }

  const guardado = await leerCarta();
  if (!guardado || guardado.updatedAt !== doc.updatedAt) {
    return error('El guardado no se confirmó. Vuelve a intentarlo.', 503);
  }

  return json({ ok: true, updatedAt: doc.updatedAt, avisos: errors, doc });
};
