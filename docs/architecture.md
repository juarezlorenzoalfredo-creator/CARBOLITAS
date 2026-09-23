# CARBOLITAS · arquitectura

Sitio estático sin framework. Un solo documento autocontenido más las
imágenes; cero dependencias en tiempo de ejecución.

## Estructura

```
src/
  config.js            datos del negocio y límites (WhatsApp, horarios, topes)
  data/menu.json       FUENTE ÚNICA de la carta: categorías, productos, opciones
  data/images.json     manifiesto generado por el pipeline de imagen
  lib/catalog.js       resuelve el JSON y valida cualquier selección externa
  lib/pricing.js       ÚNICO motor de precios (centavos enteros)
  lib/cart.js          estado del pedido + persistencia
  lib/order.js         pedido en texto y enlace de WhatsApp
  lib/format.js        formato de moneda (es-MX)
  ui/dom.js            helpers de DOM (nunca innerHTML) y trampa de foco
  ui/media.js          <img> responsive, placa de parrilla, indicador de picor
  ui/render.js         catálogo (sólo build)
  ui/sheet.js          ficha de producto
  ui/ticket.js         el pedido
  app.js               arranque y coordinación de paneles
tools/
  images.py            recorta, redimensiona y convierte a WebP
  ssr.mjs              shim de DOM mínimo para renderizar en el build
  build.mjs            SSR + empaquetado + CSP con hashes
tests/unit.test.mjs    22 pruebas de catálogo, precios, carrito y pedido
tools/qa.mjs           112 verificaciones: 14 flujos, casos límite, 12 viewports
```

## Decisiones

- **Sin framework.** Nueve productos y un carrito no justifican React ni un
  bundler. El catálogo se renderiza en el build y el cliente sólo conecta la
  interacción por delegación de eventos: la carta se ve antes de que el
  JavaScript arranque, y funciona (en modo lectura) aunque nunca arranque.
- **Un solo motor de precios.** `lib/pricing.js` alimenta la ficha, el carrito,
  el total y el mensaje. Se calcula en centavos enteros.
- **El carrito guarda referencias, nunca importes.** Al rehidratar se descartan
  productos retirados de la carta y se recalcula todo desde el catálogo vigente.
- **Un solo dueño de los paneles.** `app.js` gobierna velo, bloqueo de scroll e
  inercia del fondo; ni la ficha ni el pedido tocan el `body`.
- **Frontera de confianza.** Hoy no hay backend: el precio vive en el cliente.
  Si algún día se acepta el pedido por servidor, el servidor DEBE recalcular el
  total desde su propio catálogo y no confiar en el importe recibido.

## Comandos

```
npm run images   # regenera las variantes WebP desde assets/raw
npm run build    # dist/index.html + dist/artifact.html
npm test         # pruebas unitarias
npm run qa       # flujos, casos límite y auditoría responsive (Playwright)
```

## El documento de la carta y el panel

Desde la versión con panel administrativo hay **una sola estructura de datos**
para todo: `src/lib/document.js` la define y la valida.

```
menu.json + config.js ──build──▶ BASE_DOC ──┬──▶ SSR de dist/index.html
                                            ├──▶ dist/carta.json (sitio estático)
                                            └──▶ netlify/shared/carta-base.mjs
                                                 (respaldo de la función)

panel (dist/admin.html) ──POST /api/publicar──▶ normalizeDoc ──▶ Netlify Blobs
                                                                      │
carta del cliente ◀── GET /carta.json ◀── función carta.mjs ◀─────────┘
```

Tres decisiones que sostienen lo demás:

**El validador es uno solo y corre en los tres sitios.** `normalizeDoc` no
comprueba el documento: lo reconstruye campo por campo. Lo que no encaja se
descarta y queda anotado. El build lo usa (y falla si la carta impresa no
pasa), el servidor lo usa antes de guardar, y el cliente lo usa antes de
pintar lo que le llegó. Un fallo del panel no puede guardar basura, y un
almacén manipulado no puede pintar basura.

**La carta compilada sigue siendo la que se ve primero.** `dist/index.html`
trae el catálogo renderizado. La sincronización con lo publicado ocurre
después y sólo repinta si la fecha cambió; si falla, se traga el error y el
cliente se queda con una carta completa en lugar de una página en blanco. Por
eso `pintarCatalogo` construye todo en fragmentos y sólo al final sustituye lo
que está en pantalla.

**El horario escrito se deriva del horario real.** `describeSchedule` convierte
`{days, from, to}` en "Miércoles a lunes: 6:30 p.m. – 10:00 p.m.". No hay un
segundo campo de texto que pueda contradecir al primero.

### Por qué el bundle comprueba nombres duplicados

`tools/build.mjs` concatena los módulos del cliente en un único ámbito. Dos
archivos que declaren el mismo nombre de primer nivel producen un
`has already been declared` que rompe la página entera y que sólo se ve en
producción. El build recorre las declaraciones de cada módulo y falla antes de
escribir nada. Lo mismo hace con las rutas de imagen: si el documento
referencia un `img/…` que no existe en `dist/img/`, el build no termina.
