/** Build de producción: SSR del catálogo + un único HTML autocontenido.
 *  Genera dos salidas del mismo origen:
 *    dist/index.html    documento completo (hosting propio / QR)
 *    dist/artifact.html fragmento para publicar como Artifact
 */
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { escapeAttr, escapeText, inlineJSON } from './ssr.mjs';
import { createCatalog } from '../src/lib/catalog.js';
import { categorySection, salsasPanel } from '../src/ui/render.js';
import { pictureFor } from '../src/ui/media.js';
import { BUSINESS } from '../src/config.js';
import { normalizeDoc } from '../src/lib/document.js';
import { money } from '../src/lib/format.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const { $comment, ...MENU } = json('src/data/menu.json');
/* al cliente sólo viajan los campos que usa el runtime, no los del pipeline */
const IMAGES_FULL = json('src/data/images.json');
const IMAGES = Object.fromEntries(
  Object.entries(IMAGES_FULL).map(([k, v]) => [
    k,
    { ratio: v.ratio, variants: v.variants.map(({ w, h, src }) => ({ w, h, src })) }
  ])
);
/* Documento base: la carta impresa + los datos del negocio, ya normalizados.
   Es exactamente la misma estructura que el panel edita y que el servidor
   publica, así que build y producción no pueden divergir. */
const { doc: BASE_DOC, errors: DOC_ERRORS } = normalizeDoc(
  { ...MENU, business: BUSINESS },
  { images: Object.keys(IMAGES_FULL) }
);
if (DOC_ERRORS.length) throw new Error(`Carta base inválida:\n  ${DOC_ERRORS.join('\n  ')}`);

const catalog = createCatalog(BASE_DOC);

/* ---------- CSS ---------- */
const css = ['src/styles/base.css', 'src/styles/app.css']
  .map(read)
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s*\n\s*/g, '\n')
  .replace(/\n{2,}/g, '\n')
  .trim();

const balanced = (text, open, close) => {
  let depth = 0;
  for (const ch of text) {
    if (ch === open) depth++;
    else if (ch === close && --depth < 0) return false;
  }
  return depth === 0;
};
if (!balanced(css, '{', '}')) throw new Error('CSS con llaves desbalanceadas');

/* ---------- JS de cliente ---------- */
const CLIENT = [
  'src/lib/document.js',
  'src/config.js',
  'src/lib/format.js',
  'src/lib/catalog.js',
  'src/lib/pricing.js',
  'src/lib/cart.js',
  'src/lib/order.js',
  'src/lib/schedule.js',
  'src/lib/live.js',
  'src/ui/dom.js',
  'src/ui/media.js',
  'src/ui/render.js',
  'src/ui/sheet.js',
  'src/ui/ticket.js',
  'src/app.js'
];
/* El bundle concatena módulos en un único ámbito: dos archivos que declaren
   el mismo nombre de primer nivel rompen la página entera con un
   "has already been declared" que sólo se ve en producción. Se detecta aquí. */
const DECL = new RegExp('^(?:export\\s+)?(?:const|let|var|function|class)\\s+([A-Za-z_$][\\w$]*)', 'gm');
const declaredIn = new Map();
const clashes = [];
for (const file of CLIENT) {
  for (const m of read(file).matchAll(DECL)) {
    const name = m[1];
    if (declaredIn.has(name)) clashes.push(`${name} (${declaredIn.get(name)} y ${file})`);
    else declaredIn.set(name, file);
  }
}
if (clashes.length)
  throw new Error(`Nombres duplicados entre módulos del cliente:\n  ${clashes.join('\n  ')}`);

const js = [
  `const BASE_DOC=${inlineJSON(BASE_DOC)};`,
  `const IMAGE_MANIFEST=${inlineJSON(IMAGES)};`,
  ...CLIENT.map((file) =>
    read(file)
      .replace(/^\s*import[^\n]*\n/gm, '')
      .replace(/^export\s+/gm, '')
      .replace(/\/\*\*[\s\S]*?\*\//g, '')
      .trim()
  )
]
  .join('\n')
  .replace(/\n{2,}/g, '\n');

/* ---------- fragmentos SSR ---------- */
const img = (slug, opts) => pictureFor(IMAGES, slug, opts).toHTML();

const catalogHTML = catalog.categories
  .filter((c) => c.products.length)
  .map((c, i) => categorySection(IMAGES, c, i, () => {}).toHTML())
  .join('\n');

const salsasNode = salsasPanel(catalog);
const salsasHTML = salsasNode ? salsasNode.toHTML() : '';

const railHTML = catalog.categories
  .filter((c) => c.products.length)
  .map(
    (c, i) =>
      `<button class="railnav__btn" type="button" data-target="cat-${c.id}" aria-current="${
        i === 0 ? 'true' : 'false'
      }">${escapeText(c.name)}</button>`
  )
  .join('');

const noscriptHTML = catalog.products
  .map((p) => `<li>${escapeText(p.name)} — ${money(p.basePrice)}</li>`)
  .join('');

const hhmm = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const jsonLd = inlineJSON({
  '@context': 'https://schema.org',
  '@type': 'Restaurant',
  name: BUSINESS.name,
  servesCuisine: ['Alitas', 'Hamburguesas', 'Comida rápida'],
  priceRange: '$$',
  image: 'img/alitas-salsa-560.webp',
  ...(BUSINESS.address
    ? {
        address: {
          '@type': 'PostalAddress',
          streetAddress: 'Av. 16 de Septiembre 46',
          addressLocality: 'San Miguel Curahuango, Maravatío de Ocampo',
          addressRegion: 'Michoacán',
          postalCode: '61253',
          addressCountry: 'MX'
        }
      }
    : {}),
  ...(BUSINESS.phone ? { telephone: `+52${BUSINESS.phone}` } : {}),
  ...(BUSINESS.mapsUrl ? { hasMap: BUSINESS.mapsUrl } : {}),
  ...(BUSINESS.schedule
    ? {
        openingHoursSpecification: [
          {
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: BUSINESS.schedule.days.map(
              (d) =>
                [
                  'Sunday',
                  'Monday',
                  'Tuesday',
                  'Wednesday',
                  'Thursday',
                  'Friday',
                  'Saturday'
                ][d]
            ),
            opens: hhmm(BUSINESS.schedule.from),
            closes: hhmm(BUSINESS.schedule.to)
          }
        ]
      }
    : {}),
  hasMenu: {
    '@type': 'Menu',
    hasMenuSection: catalog.categories
      .filter((c) => c.products.length)
      .map((c) => ({
        '@type': 'MenuSection',
        name: c.name,
        hasMenuItem: c.products.map((p) => ({
          '@type': 'MenuItem',
          name: p.name,
          description: p.description,
          offers: { '@type': 'Offer', price: p.basePrice, priceCurrency: MENU.currency }
        }))
      }))
  }
});

/* ---------- política de seguridad de contenido ----------
   Se hashean los bloques inline: no hace falta 'unsafe-inline'. */
const sha = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
const CSP = [
  "default-src 'none'",
  `script-src ${sha(js)} ${sha(jsonLd)}`,
  `style-src ${sha(css)} https://fonts.googleapis.com`,
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'"
  /* frame-ancestors sólo aplica por cabecera HTTP: ver docs/hosting.md */
].join('; ');

/* ---------- documento ---------- */
const TITLE = 'CARBOLITAS · Carta';
const ARTIFACT_TITLE = 'Carbolitas';
const DESC =
  'Carta digital de CARBOLITAS: alitas al carbón, boneless, hamburguesas a la parrilla, carbopapas y dogos. Arma tu comanda y envíala en un toque.';
const FONTS =
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,700;0,800;1,500;1,600&family=Archivo:wght@400;500;600;700;800&display=swap';

const srcsetOf = (slug) => IMAGES[slug].variants.map((v) => `${v.src} ${v.w}w`).join(', ');
const largestOf = (slug) => IMAGES[slug].variants[IMAGES[slug].variants.length - 1].src;
const ogImage = largestOf('portada');
const telPretty = BUSINESS.phone
  ? BUSINESS.phone.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3')
  : '';

const ICON = {
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  cart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h2l2.2 10.2a2 2 0 0 0 2 1.6h6.9a2 2 0 0 0 2-1.5L21 8H7"/><circle cx="10" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/></svg>',
  bolsa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  mesa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h16"/><path d="M7 10V6m10 4V6"/><path d="M6 10v8m12-8v8"/></svg>',
  wa: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.6 20.4 4.9 16.6A8.5 8.5 0 1 1 8.1 19.6l-4.5.8Z"/><path d="M9.1 9.3c.2-.5.5-.5.8-.5h.5c.2 0 .4 0 .6.4l.7 1.7c0 .2 0 .4-.1.5l-.5.6c-.2.2-.2.3-.1.5.4.8 1.5 1.9 2.8 2.5.2.1.4.1.5-.1l.5-.6c.2-.2.4-.2.6-.1l1.6.8c.3.1.4.3.3.6-.2.7-1 1.4-1.7 1.5-1.9.2-5.1-2.2-6-4.5-.4-1-.6-2.2-.5-3.3Z"/></svg>'
};

const mapsLink = BUSINESS.mapsUrl
  ? `<a href="${escapeAttr(BUSINESS.mapsUrl)}" target="_blank" rel="noopener noreferrer">Cómo llegar</a>`
  : '';

const datosHTML = [
  BUSINESS.address
    ? `<li><b>Dónde</b><span>${escapeText(BUSINESS.address)} ${mapsLink}</span></li>`
    : '',
  ...BUSINESS.hours.map(
    (h) => `<li><b>Horario</b><span>${escapeText(h.days)}: ${escapeText(h.hours)}</span></li>`
  ),
  BUSINESS.phone
    ? `<li><b>Pedidos</b><span><a href="tel:+52${escapeAttr(BUSINESS.phone)}">${escapeText(
        telPretty
      )}</a></span></li>`
    : ''
].join('');

const segmentedHTML = BUSINESS.serviceModes
  .map(
    (m, i) =>
      `<button class="segmented__btn" type="button" data-mode="${escapeAttr(m.id)}" aria-pressed="${
        i === 0 ? 'true' : 'false'
      }">${m.id === 'llevar' ? ICON.bolsa : ICON.mesa}<span>${escapeText(m.label)}</span></button>`
  )
  .join('');

const drawerNavHTML = catalog.categories
  .filter((c) => c.products.length)
  .map(
    (c) =>
      `<button type="button" data-target="cat-${c.id}">${escapeText(c.name)}</button>`
  )
  .join('');

const body = `
<a class="skip" href="#carta">Ir a la carta</a>

<header class="topbar">
  <button class="iconbtn" id="menubtn" type="button" aria-label="Abrir menú" aria-expanded="false">${ICON.menu}</button>
  <img class="topbar__mark" src="img/logo-256.webp" srcset="img/logo-256.webp 256w, img/logo-512.webp 512w" sizes="44px" width="256" height="256" alt="Carbolitas" decoding="async">
  <button class="iconbtn iconbtn--cart" id="cartbtn" type="button" aria-label="Ver pedido">${ICON.cart}<span class="cartdot" id="cartdot" data-on="false">0</span></button>
</header>

<main id="main">
  <section class="hero" aria-labelledby="brand">
    <div class="hero__bg" aria-hidden="true"><picture><source media="(min-width: 48rem)" srcset="${srcsetOf(
      'portada-alta'
    )}" sizes="58vw">${img('portada', { sizes: '100vw', alt: '', priority: true })}</picture></div>

    <div class="hero__brand">
      <img class="hero__logo" src="img/logo-512.webp" srcset="img/logo-256.webp 256w, img/logo-512.webp 512w" sizes="120px" width="512" height="512" alt="" decoding="async" fetchpriority="high">
      <h1 class="hero__word" id="brand"><span class="sr-only">Carbolitas</span><svg viewBox="0 0 1000 168" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet"><text x="0" y="140" textLength="1000" lengthAdjust="spacingAndGlyphs" font-size="190" fill="#f7f1e6">CARBOLITAS</text></svg></h1>
      <p class="hero__rule">Sabor al carbón</p>
      ${
        BUSINESS.hours.length
          ? `<p class="hero__status" id="status" data-open="">${escapeText(
              `${BUSINESS.hours[0].days} · ${BUSINESS.hours[0].hours}`
            )}</p>`
          : ''
      }
    </div>

    <div class="hero__claim">
      <h2>Sabor<em>que antoja</em></h2>
      <p>Alitas al carbón siempre una buena idea</p>
      <div class="segmented" role="group" aria-label="Cómo quieres tu pedido">${segmentedHTML}</div>
    </div>
  </section>

  <nav class="railnav" id="carta" aria-label="Categorías de la carta">
    <div class="railnav__scroll" id="rail">${railHTML}</div>
  </nav>

  <div class="shell">
    <div class="flow">
      <p class="notice" id="notice" role="status" hidden></p>
      <noscript><p class="cat__note">Activa JavaScript para armar tu pedido. Precios: <ul>${noscriptHTML}</ul></p></noscript>
      <div id="catalog">${catalogHTML}</div>

      ${salsasHTML}

      <button class="wa" id="wabtn" type="button">
        <span class="wa__icon">${ICON.wa}</span>
        <span class="wa__text"><span id="wa-label">Pedir por WhatsApp</span><b id="wa-number">${escapeText(
          telPretty
        )}</b></span>
        <span class="wa__go" aria-hidden="true">›</span>
      </button>

      <section class="place" aria-labelledby="place-title">
        <div class="place__media">${img('local', {
          sizes: '(min-width: 48rem) 32rem, 100vw',
          alt: 'Interior del local con mesas, letreros de neón y la parrilla al fondo'
        })}</div>
        <div class="place__body">
          <h2 class="place__title" id="place-title">El local</h2>
          <p class="place__text">Mesas, parrilla encendida y la tele prendida. Come aquí o pasa por lo tuyo.</p>
          <ul class="place__data" id="place-data">${datosHTML}</ul>
        </div>
      </section>

      <footer class="foot">
        <strong>Carbolitas</strong>
        <span class="foot__tag">Buena comida, mejores momentos</span>
        <small><span id="foot-address">${escapeText(BUSINESS.address)}</span> · Precios en pesos mexicanos (MXN)</small>
      </footer>
    </div>

    <aside class="dock" id="dock"></aside>
  </div>
</main>

<button class="combar" id="combar" type="button" data-visible="false" aria-label="Ver pedido">
  <span class="combar__count">0</span>
  <span class="combar__label"><b>Tu pedido</b><span>Toca para revisar</span></span>
  <span class="combar__total">$0</span>
</button>

<aside class="drawer" id="drawer" aria-label="Menú" data-open="false">
  <div class="drawer__head">
    <img src="img/logo-256.webp" width="256" height="256" alt="" loading="lazy" decoding="async">
    <span>Carbolitas</span>
    <button class="drawer__close" id="drawerclose" type="button" aria-label="Cerrar menú">✕</button>
  </div>
  <nav aria-label="Categorías" id="drawer-nav">${drawerNavHTML}</nav>
  <div class="drawer__foot" id="drawer-foot">
    <span>${escapeText(BUSINESS.address)}</span>
    ${BUSINESS.phone ? `<a href="tel:+52${escapeAttr(BUSINESS.phone)}">${escapeText(telPretty)}</a>` : ''}
    ${mapsLink}
  </div>
</aside>

<div class="scrim" id="scrim" data-on="false"></div>
<div class="sheet" id="sheet"></div>
<p class="flash" id="flash" data-on="false" role="status"></p>
<div class="sr-only" id="live" aria-live="polite" role="status"></div>

<script type="application/ld+json">${jsonLd}</script>
<script type="module">${js}</script>
`.trim();

const head = `
<title>${TITLE}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>${css}</style>`.trim();

const full = `<!doctype html>
<html lang="es-MX">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="${DESC}">
<meta name="theme-color" content="#14110e">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="color-scheme" content="dark">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESC}">
<meta property="og:type" content="restaurant.menu">
<meta property="og:image" content="${ogImage}">
<link rel="icon" href="img/logo-256.webp" type="image/webp">
<link rel="apple-touch-icon" href="img/logo-256.webp">
<link rel="preload" as="image" imagesrcset="${srcsetOf('portada')}" imagesizes="100vw" fetchpriority="high">
${head}
</head>
<body>
${body}
</body>
</html>`;

const artifact = `${head.replace(`<title>${TITLE}</title>`, `<title>${ARTIFACT_TITLE}</title>`)}\n${body}`;

writeFileSync(join(ROOT, 'dist/index.html'), full);
writeFileSync(join(ROOT, 'dist/artifact.html'), artifact);

/* ---------- archivos de despliegue ----------
   Netlify (y cualquier hosting estático) lee estos ficheros desde la raíz de
   la carpeta publicada. Se generan aquí para que arrastrar `dist/` baste. */

/* Sin post-procesado: si Netlify reescribiera un solo byte del <script> o del
   <style> inline, los hashes sha256 del CSP dejarían de coincidir y el
   navegador bloquearía la página entera. */
const NETLIFY_TOML = `# CARBOLITAS - generado por tools/build.mjs, no editar a mano.
# Sirve para el despliegue arrastrando esta carpeta a Netlify (sitio estatico,
# sin panel en vivo). La configuracion del sitio con panel esta en el
# netlify.toml de la raiz del proyecto.

[build.processing]
  skip_processing = true

[build.processing.html]
  pretty_urls = false
`;

/* Cabeceras de seguridad y caché. frame-ancestors sólo funciona por cabecera,
   por eso va aquí y no en el <meta> del documento. */
const HEADERS = `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Content-Security-Policy: frame-ancestors 'none'
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains

/index.html
  Cache-Control: public, max-age=0, must-revalidate

/carta.json
  Content-Type: application/json; charset=utf-8
  Cache-Control: public, max-age=0, must-revalidate

/carta-base.json
  Content-Type: application/json; charset=utf-8
  Cache-Control: public, max-age=0, must-revalidate

/img/*
  Cache-Control: public, max-age=31536000, immutable

/admin.html
  Cache-Control: no-store
  X-Robots-Tag: noindex, nofollow

/panel-en-tu-computadora.html
  Cache-Control: no-store
  X-Robots-Tag: noindex, nofollow
`;

const ROBOTS = `User-agent: *
Allow: /
`;

/* Página 404 con la marca: si alguien teclea mal la URL del QR, ve la carta a
   un toque y no el error genérico del hosting. */
const CSS_404 = `:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100svh;display:grid;place-items:center;padding:2rem;
background:radial-gradient(120% 90% at 50% 0%,#241d16,#14110e 62%);color:#f4ede4;
font-family:Archivo,system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center}
img{width:104px;height:104px;border-radius:50%}
h1{font-family:"Playfair Display",Georgia,serif;font-size:clamp(1.6rem,6vw,2.4rem);margin:1.2rem 0 .4rem;font-weight:700}
p{margin:0 0 1.6rem;color:#b9ab99;max-width:34ch;line-height:1.5}
a{display:inline-block;background:#f2762b;color:#14110e;font-weight:700;text-decoration:none;
padding:.9rem 1.6rem;border-radius:999px;min-height:44px}`;

const html404 = `<!doctype html>
<html lang="es-MX">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${sha(
  CSS_404
)} https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self'; base-uri 'none'; form-action 'none'">
<title>Página no encontrada · ${TITLE}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>${CSS_404}</style>
</head>
<body>
<main>
<img src="img/logo-256.webp" alt="${escapeAttr(BUSINESS.name)}" width="104" height="104">
<h1>Esta página no existe</h1>
<p>Pero la carta sí. Vuelve al inicio y arma tu pedido.</p>
<a href="/">Ver la carta</a>
</main>
</body>
</html>`;

writeFileSync(join(ROOT, 'dist/netlify.toml'), NETLIFY_TOML);
writeFileSync(join(ROOT, 'dist/_headers'), HEADERS);
writeFileSync(join(ROOT, 'dist/robots.txt'), ROBOTS);

/* Instrucciones para quien sube la carpeta. Se generan aquí para que no se
   queden desfasadas respecto al contenido real de dist/. */
const LEEME = `CARBOLITAS - COMO PUBLICAR ESTA CARTA
=====================================

Lo que estas viendo es la carpeta COMPLETA del sitio. Se sube entera.
No subas solo index.html: las fotografias viven en la subcarpeta img/ y el
archivo HTML las busca junto a el.

  index.html      la carta
  admin.html      el panel para cambiar precios, platillos y horarios
  carta.json      la carta en datos: es lo que el panel edita
  404.html        pagina de error con la marca
  img/            las fotos. SIN ESTA CARPETA NO HAY IMAGENES.
  _headers        cabeceras de seguridad y de cache
  netlify.toml    evita que Netlify reescriba el HTML
  robots.txt


NETLIFY, ARRASTRANDO LA CARPETA
-------------------------------
1. Entra a https://app.netlify.com/drop
2. Arrastra ESTA CARPETA completa al recuadro. No abras la carpeta ni
   selecciones los archivos sueltos: arrastra la carpeta.
3. Espera a que termine. Ya esta publicado.

Si el sitio pide iniciar sesion ("This site is private"):
  Site configuration - Access & security - Visitor access
  Mientras este privado, tus clientes ven un login de Netlify, no la carta.

Para que la direccion sea presentable:
  Site configuration - Site details - Change site name


EL PANEL
--------
Se abre en tusitio/admin.html, y pide contrasena.

Subiendo esta carpeta a mano (sin el repositorio) NO hay servidor que pueda
comprobar una contrasena, asi que el panel se queda apagado: muestra una
pantalla que explica como encenderlo y no abre el editor. Es a proposito: un
candado que se revisa en el navegador del visitante no es un candado.

Para cambiar la carta mientras tanto, usa el archivo
panel-en-tu-computadora.html que viene en el proyecto: se abre con doble clic
desde tu computadora, no esta en internet, y al publicar te descarga un
carta.json que subes a esta carpeta junto a index.html.

Para que el panel publique en vivo -cambias un precio y los clientes lo ven al
instante- el sitio tiene que desplegarse desde el repositorio del proyecto y
llevar la variable ADMIN_PASSWORD, de 12 caracteres o mas. Los pasos completos
estan en docs/panel.md.


CUALQUIER OTRO HOSTING
----------------------
Sube el contenido de esta carpeta a la raiz del sitio. Funciona en Vercel,
Cloudflare Pages, GitHub Pages, hosting compartido con cPanel o un servidor
propio. No requiere base de datos ni servidor de aplicacion.


COMPROBACION RAPIDA
-------------------
Abre la carta publicada y verifica:
  - Se ven las fotos de las alitas y las hamburguesas.
  - El logotipo redondo aparece arriba a la izquierda.
  - Al tocar un platillo se abre la ficha para elegir salsa.
  - El boton naranja abre WhatsApp con el pedido escrito.

Si no se ven las fotos, casi siempre es que se subio solo el HTML.
`;

writeFileSync(join(ROOT, 'dist/LEEME.txt'), LEEME);
writeFileSync(join(ROOT, 'dist/404.html'), html404);

/* La carta vigente como archivo: es lo que lee el cliente cuando el sitio se
   publica sin panel, y lo que el panel descarga y se vuelve a subir en modo
   local. Con panel, Netlify reescribe esta ruta hacia la función. */
writeFileSync(join(ROOT, 'dist/carta.json'), JSON.stringify(BASE_DOC, null, 1));

/* Copia de respaldo que la función sirve mientras nadie haya publicado nada
   desde el panel. No se reescribe hacia la función, por eso el nombre aparte. */
writeFileSync(join(ROOT, 'dist/carta-base.json'), JSON.stringify(BASE_DOC));

/* ---------- panel administrativo ----------
   Mismo empaquetado que la carta: un solo documento, CSS y JS en línea
   autorizados por hash, sin dependencias externas. */
const adminCss = read('src/admin/admin.css').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '\n').trim();
if (!balanced(adminCss, '{', '}')) throw new Error('CSS del panel con llaves desbalanceadas');

const adminJs = [
  `window.SLUGS_BASE=${inlineJSON(Object.keys(IMAGES_FULL))};`,
  /* La carta viaja dentro del panel para que la copia que se abre con doble
     clic desde la computadora funcione sin red. */
  `window.CARTA_EMBEBIDA=${inlineJSON(BASE_DOC)};`,
  ...['src/lib/document.js', 'src/admin/admin.js'].map((file) =>
    read(file)
      .replace(/^\s*import[^\n]*\n/gm, '')
      .replace(/^export\s+/gm, '')
      .replace(/\/\*\*[\s\S]*?\*\//g, '')
      .trim()
  )
].join('\n');

const adminCsp = [
  "default-src 'none'",
  `script-src ${sha(adminJs)}`,
  `style-src ${sha(adminCss)} https://fonts.googleapis.com`,
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

/* El logotipo va incrustado cuando el panel se abre desde el disco: ahí no hay
   carpeta img/ al lado. */
const logoData = `data:image/webp;base64,${readFileSync(
  join(ROOT, 'dist/img/logo-256.webp')
).toString('base64')}`;

const panelHtml = (logo, offline = false) => `<!doctype html>
<html lang="es-MX">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${adminCsp}">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0d0c0b">
<meta name="color-scheme" content="dark">
<title>Panel · ${escapeAttr(BUSINESS.name)}</title>
<link rel="icon" href="${logo}">
${
  offline
    ? '<!-- sin tipografías externas: esta copia funciona sin internet -->'
    : `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="${FONTS}">`
}
<style>${adminCss}</style>
</head>
<body>
<header class="top">
  <div class="wrap top__in">
    <img src="${logo}" width="36" height="36" alt="">
    <h1>Panel<span class="top__brand"> · ${escapeText(BUSINESS.name)}</span></h1>
    <span class="top__sp"></span>
    <span class="pill" id="modo">Cargando…</span>
    <button class="btn btn--ghost" id="salir" type="button">Salir</button>
  </div>
</header>

<main class="wrap">
  <section class="gate" id="gate" hidden>
    <form>
      <img class="gate__mark" src="${logo}" width="72" height="72" alt="">
      <h2>Entrar al panel</h2>
      <p>Escribe la contraseña del panel para cambiar la carta.</p>
      <p class="msg" id="gate-nota" hidden></p>
      <div class="f">
        <label for="password">Contraseña</label>
        <input id="password" type="password" autocomplete="current-password"
               autocapitalize="off" autocorrect="off" spellcheck="false" required>
      </div>
      <p class="msg msg--bad" id="gate-error" hidden></p>
      <button class="btn btn--primary" id="entrar" type="submit">Entrar</button>
      <small>La sesión se cierra sola tras 30 minutos sin actividad, y al cerrar esta pestaña.</small>
    </form>
  </section>

  <section class="gate" id="apagado" hidden>
    <div class="gate__box">
      <img class="gate__mark" src="${logo}" width="72" height="72" alt="">
      <h2>El panel está apagado en este sitio</h2>
      <p>
        Esta copia de la carta se publicó sin el servidor del panel. Sin él no hay
        contraseña que comprobar, así que el panel no se abre: cualquier candado
        que se revisara aquí, en el navegador del visitante, no sería un candado.
      </p>
      <p>
        Para encenderlo hay que publicar el sitio desde el repositorio del proyecto
        y poner la contraseña en la variable <code>ADMIN_PASSWORD</code>. Los pasos
        están en <code>docs/panel.md</code>.
      </p>
      <p>
        Mientras tanto, para cambiar la carta usa el archivo
        <code>panel-en-tu-computadora.html</code> que viene con el proyecto: se abre
        con doble clic desde tu computadora y no está en internet.
      </p>
      <a class="btn btn--primary" href="/">Ver la carta</a>
    </div>
  </section>

  <div id="app" hidden>
    <div class="tabs" role="tablist">
      <button class="tab" type="button" role="tab" aria-selected="true" data-panel="tab-platillos">Platillos</button>
      <button class="tab" type="button" role="tab" aria-selected="false" data-panel="tab-categorias">Categorías</button>
      <button class="tab" type="button" role="tab" aria-selected="false" data-panel="tab-opciones">Salsas y opciones</button>
      <button class="tab" type="button" role="tab" aria-selected="false" data-panel="tab-negocio">Negocio</button>
      <button class="tab" type="button" role="tab" aria-selected="false" data-panel="tab-respaldo">Respaldo</button>
    </div>

    <p class="msg" id="aviso" hidden></p>

    <section class="panel" id="tab-platillos">
      <h2 class="sec">Platillos</h2>
      <p class="sec">Toca un platillo para abrirlo y cambiar su precio, su foto o su orden. El botón verde de la derecha lo agota o lo repone sin abrir nada.</p>
      <div id="lista-platillos"></div>
    </section>

    <section class="panel" id="tab-categorias" hidden>
      <h2 class="sec">Categorías</h2>
      <p class="sec">Las secciones de la carta y el orden en que aparecen. Para quitar una, primero mueve o quita sus platillos.</p>
      <div id="lista-categorias"></div>
    </section>

    <section class="panel" id="tab-opciones" hidden>
      <h2 class="sec">Salsas y opciones</h2>
      <p class="sec">Lo que el cliente elige antes de agregar un platillo.</p>
      <div id="lista-opciones"></div>
    </section>

    <section class="panel" id="tab-negocio" hidden>
      <h2 class="sec">Datos del negocio</h2>
      <p class="sec">Lo que aparece en la carta y a dónde llega el pedido.</p>
      <div id="form-negocio"></div>
    </section>

    <section class="panel" id="tab-respaldo" hidden>
      <h2 class="sec">Respaldo</h2>
      <div id="form-respaldo"></div>
    </section>
  </div>
</main>

<div class="bar" id="bar" hidden>
  <div class="wrap bar__in">
    <div class="bar__state" id="bar-state"></div>
    <button class="btn btn--primary" id="publicar" type="button" disabled>Publicar cambios</button>
  </div>
</div>

<p class="toast" id="toast" role="status" data-on="false"></p>

<script type="module">${adminJs}</script>
</body>
</html>`;

/* Dos copias del mismo panel:
   · dist/admin.html            va al sitio y sólo abre con contraseña del
                                servidor; sin funciones se muestra apagado.
   · panel-en-tu-computadora.html  se abre con doble clic desde la computadora.
                                No está en internet, así que no hay nada que
                                cerrar con llave: edita y descarga carta.json. */
writeFileSync(join(ROOT, 'dist/admin.html'), panelHtml('img/logo-256.webp'));
writeFileSync(join(ROOT, 'panel-en-tu-computadora.html'), panelHtml(logoData, true));

/* El documento con el que se compiló el sitio, dentro del propio bundle de la
   función: es lo que se sirve mientras nadie haya publicado nada. Va aquí y no
   como una petición HTTP para no depender del Host de quien pregunta. */
writeFileSync(
  join(ROOT, 'netlify/shared/carta-base.mjs'),
  `/* Generado por tools/build.mjs. No editar. */\nexport const CARTA_BASE = ${JSON.stringify(
    BASE_DOC
  )};\n`
);

/* Las fotos que vienen con el sitio, para que el servidor sepa cuáles son
   rutas legítimas al validar lo que manda el panel. */
writeFileSync(
  join(ROOT, 'netlify/shared/slugs.mjs'),
  `/* Generado por tools/build.mjs. No editar. */\nexport const SLUGS = ${JSON.stringify(
    Object.keys(IMAGES_FULL)
  )};\n`
);

/* ---------- verificación de assets ----------
   Toda ruta img/… que aparezca en el documento tiene que existir en disco.
   Un preload o un og:image apuntando a un archivo inexistente es un 404 que
   nadie ve en desarrollo y que sí se nota en producción. */
const referenced = new Set(
  [...`${full}\n${html404}`.matchAll(/img\/[A-Za-z0-9._-]+\.webp/g)].map((m) => m[0])
);
const missing = [...referenced].filter((rel) => !existsSync(join(ROOT, 'dist', rel)));
if (missing.length) throw new Error(`Assets referenciados que no existen: ${missing.join(', ')}`);

const kb = (p) => (statSync(join(ROOT, p)).size / 1024).toFixed(1);
console.log(`build ok
  dist/index.html     ${kb('dist/index.html')} KB
  dist/artifact.html  ${kb('dist/artifact.html')} KB
  dist/admin.html     ${kb('dist/admin.html')} KB
  panel-en-tu-computadora.html  ${kb('panel-en-tu-computadora.html')} KB
  css ${(css.length / 1024).toFixed(1)} KB · js ${(js.length / 1024).toFixed(1)} KB (incl. datos)
  ${catalog.products.length} productos · ${catalog.categories.length} categorías`);
