/**
 * GET /carta.json — la carta vigente.
 *
 * Devuelve lo último publicado desde el panel. Si nunca se ha publicado nada,
 * devuelve la carta con la que se compiló el sitio, así que el cliente siempre
 * recibe una carta completa.
 */
import { leerCarta } from './store.mjs';
import { normalizeDoc } from '../src/lib/document.js';
import { SLUGS } from './slugs.mjs';
import { CARTA_BASE } from './carta-base.mjs';

export default async () => {
  /* Lo publicado manda; si todavía no se ha publicado nada, la carta con la
     que se compiló el sitio. */
  const doc = (await leerCarta()) || CARTA_BASE;
  const { doc: limpio } = normalizeDoc(doc, { images: SLUGS });
  return new Response(JSON.stringify(limpio), { status: 200, headers: cabeceras() });
};

function cabeceras() {
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=0, must-revalidate',
    'x-content-type-options': 'nosniff',
    /* Marca que esta respuesta la sirve la función y no un archivo estático:
       es como el panel sabe si puede publicar en vivo. */
    'x-carbolitas-panel': '1'
  };
}
