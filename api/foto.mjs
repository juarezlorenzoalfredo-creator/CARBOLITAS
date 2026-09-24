/** Envoltorio de Vercel. Vercel entrega un Request web estándar y espera un
 *  objeto con `fetch`; la lógica vive en server/foto.mjs, la misma que usa
 *  Netlify. */
import handler from '../server/foto.mjs';

export const config = { runtime: 'nodejs' };

export default {
  fetch(request) {
    return handler(request);
  }
};
