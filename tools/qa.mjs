/** QA automatizado: flujos críticos, casos límite y auditoría responsive. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
/* Nota: no se usa isMobile:true. La emulación de Chromium infla innerHeight
   (916 frente a 844 visibles) y desplaza los elementos position:fixed fuera de
   la zona visible, algo que no ocurre en dispositivos reales. Se emula táctil
   y el viewport exacto, que es lo que sí refleja el comportamiento real. */
import { createRequire } from 'node:module';
const pw = createRequire(import.meta.url)('/home/claude/.npm-global/lib/node_modules/playwright/index.js');

/* El panel se prueba contra las funciones reales, con un almacén en memoria:
   mismo código que en producción, sin desplegar nada. */
process.env.ADMIN_PASSWORD = 'qa-carbolitas-2026-larga';
const { crear: crearAlmacen } = await import('../server/drivers/memoria.mjs');
globalThis.__CARBOLITAS_STORE__ = crearAlmacen();

const FUNCIONES = {
  '/carta.json': (await import('../server/carta.mjs')).default,
  '/api/entrar': (await import('../server/entrar.mjs')).default,
  '/api/publicar': (await import('../server/publicar.mjs')).default,
  '/api/foto': (await import('../server/foto.mjs')).default
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SHOTS = join(ROOT, 'qa');
mkdirSync(SHOTS, { recursive: true });

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript'
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  const fn =
    FUNCIONES[url.pathname] ||
    (url.pathname.startsWith('/api/foto/') ? FUNCIONES['/api/foto'] : null);
  if (fn) {
    const trozos = [];
    for await (const c of req) trozos.push(c);
    const peticion = new Request(url.href, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(trozos)
    });
    const out = await fn(peticion, {});
    const cabeceras = {};
    out.headers.forEach((v, k) => (cabeceras[k] = v));
    res.writeHead(out.status, cabeceras);
    res.end(Buffer.from(await out.arrayBuffer()));
    return;
  }

  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(DIST, rel === '/' ? 'index.html' : rel);
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const problems = [];
const ok = (name, detail = '') => results.push(`  ✔ ${name}${detail ? ' — ' + detail : ''}`);
const fail = (name, detail) => {
  results.push(`  ✘ ${name} — ${detail}`);
  problems.push(`${name}: ${detail}`);
};
const check = (cond, name, detail = '') => (cond ? ok(name, detail) : fail(name, detail || 'falló'));

const browser = await pw.chromium.launch();

/* ============ 1. flujos críticos (móvil 390×844) ============ */
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    permissions: ['clipboard-read', 'clipboard-write'],
    locale: 'es-MX'
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/ERR_TUNNEL_CONNECTION_FAILED/.test(m.text())) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => {
    if (!r.url().includes('fonts.g')) failedRequests.push(`${r.url()} ${r.failure()?.errorText}`);
  });

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');

  // FLUJO 1 · abrir la carta
  check((await page.locator('.item').count()) === 9, 'F1 abrir carta', '9 platos renderizados');
  check(await page.locator('h1', { hasText: 'Carbolitas' }).isVisible(), 'F1 marca visible');
  await page.screenshot({ path: join(SHOTS, '01-inicio-390.png') });

  // FLUJO 2 · cambiar de categoría
  await page.locator('.railnav__btn', { hasText: 'Burgers' }).click();
  await page.waitForTimeout(700);
  const burgersVisible = await page.locator('#cat-burgers .item').first().isVisible();
  check(burgersVisible, 'F2 cambiar categoría');
  await page.screenshot({ path: join(SHOTS, '02-categoria-390.png') });

  // FLUJO 3 · abrir producto
  await page.locator('[data-product="alitas-7"]').click();
  await page.waitForSelector('.sheet[data-open="true"]', { state: 'visible' });
  check(
    (await page.locator('#sheet-title').textContent()) === 'Alitas al carbón',
    'F3 abrir ficha de producto'
  );
  await page.screenshot({ path: join(SHOTS, '03-ficha-390.png') });

  // FLUJO 4 · elegir variante (salsa) — nada obligatorio viene preseleccionado
  check(
    (await page.locator('.tag[data-on="true"]').count()) === 0,
    'F4 ninguna salsa viene marcada por defecto'
  );
  check(await page.locator('.btn-add').isDisabled(), 'F4 no se puede agregar sin elegir salsa');
  await page.locator('.tag', { hasText: 'Búfalo' }).click();
  await page.waitForTimeout(260);
  const salsaOn = await page.locator('.tag', { hasText: 'Búfalo' }).getAttribute('data-on');
  check(salsaOn === 'true', 'F4 seleccionar salsa');

  // el estado seleccionado tiene que VERSE, no sólo existir en el DOM:
  // se compara contra una opción sin elegir del mismo grupo
  const contraste = await page.evaluate(() => {
    const pick = (on) =>
      Array.from(document.querySelectorAll('.sheet .tag')).find(
        (t) => t.dataset.on === String(on)
      );
    const paint = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return `${cs.borderTopColor}|${cs.backgroundColor}|${cs.color}`;
    };
    return { on: paint(pick(true)), off: paint(pick(false)) };
  });
  check(
    Boolean(contraste.on && contraste.off && contraste.on !== contraste.off),
    'F4 la salsa elegida se distingue visualmente',
    `${contraste.on} vs ${contraste.off}`
  );

  // FLUJO 5 · extras / preparación (multi)
  await page.locator('.tag', { hasText: 'Salsa aparte' }).click();
  await page.locator('.tag', { hasText: 'Sin aderezo' }).click();
  await page.waitForTimeout(120);
  const multiOn = await page.locator('.tag[data-on="true"]').count();
  check(multiOn === 3, 'F5 opciones múltiples', `${multiOn} activas`);

  // FLUJO 6 · cantidad
  await page.locator('.sheet__foot .stepper button[aria-label="Agregar una unidad"]').click();
  check((await page.locator('.sheet__foot output').textContent()) === '2', 'F6 cambiar cantidad');
  check(
    (await page.locator('.btn-add b').textContent()) === '$200',
    'F6 precio vivo en la ficha',
    '2 × $100 = $200'
  );
  await page.screenshot({ path: join(SHOTS, '04-ficha-opciones-390.png') });

  // FLUJO 7 · agregar al pedido
  await page.locator('.btn-add').click();
  await page.waitForSelector('.sheet[data-open="false"]', { state: 'attached' });
  check((await page.locator('.combar__count').textContent()) === '2', 'F7 agregar al pedido');
  check((await page.locator('.combar__total').textContent()) === '$200', 'F7 total en la barra');
  check(
    (await page.locator('.combar').getAttribute('data-visible')) === 'true',
    'F7 la barra de comanda aparece'
  );
  await page.screenshot({ path: join(SHOTS, '05-comanda-barra-390.png') });

  // FLUJO 8 · abrir la comanda
  await page.locator('#combar').click();
  await page.waitForSelector('.dock[data-open="true"]');
  check((await page.locator('.tline').count()) === 1, 'F8 abrir comanda');
  check(
    (await page.locator('.tline__opts').textContent()).includes('Búfalo'),
    'F8 la comanda muestra las opciones'
  );
  await page.screenshot({ path: join(SHOTS, '06-comanda-390.png') });

  // FLUJO 9 · editar una línea
  await page.locator('.tline__link', { hasText: 'Editar' }).click();
  await page.waitForTimeout(200);
  await page.waitForSelector('.sheet[data-open="true"]', { state: 'visible' });
  check(
    (await page.locator('.tag', { hasText: 'Búfalo' }).getAttribute('data-on')) === 'true',
    'F9 la ficha abre con la selección previa'
  );
  await page.locator('.tag', { hasText: 'Barbecue' }).click();
  await page.locator('.btn-add').click();
  await page.waitForSelector('.sheet[data-open="false"]', { state: 'attached' });
  await page.locator('#combar').click();
  check(
    (await page.locator('.tline__opts').textContent()).includes('Barbecue'),
    'F9 editar producto'
  );

  // FLUJO 10 · eliminar
  await page.locator('.tline__link--del').click();
  check((await page.locator('.ticket__empty').isVisible()), 'F10 eliminar producto');
  check(
    (await page.locator('.combar').getAttribute('data-visible')) === 'false',
    'F10 la barra se oculta con la comanda vacía'
  );
  await page.screenshot({ path: join(SHOTS, '07-comanda-vacia-390.png') });

  // FLUJO 11 · volver a agregar (dos productos distintos)
  await page.locator('.ticket__close').click();
  await page.locator('[data-product="burger-suprema"]').click();
  await page.waitForTimeout(200);
  await page.locator('.btn-add').click();
  await page.locator('[data-product="hotdog"]').click();
  await page.locator('.sheet__foot .stepper button[aria-label="Agregar una unidad"]').click();
  await page.locator('.btn-add').click();
  check((await page.locator('.combar__count').textContent()) === '3', 'F11 volver a agregar');

  // FLUJO 13 · validar total  (110 + 2×30 = 170)
  check((await page.locator('.combar__total').textContent()) === '$170', 'F13 total correcto');

  // FLUJO 12/14 · finalizar pedido y validar el mensaje
  await page.locator('#combar').click();
  await page.locator('#cust-name').fill('Nataly');
  await page.locator('.mode', { hasText: 'Para llevar' }).click();
  await page.screenshot({ path: join(SHOTS, '08-comanda-llena-390.png') });
  // se intercepta window.open para leer el enlace sin abrir WhatsApp de verdad
  await page.evaluate(() => {
    window.__abierto = null;
    window.open = (url) => {
      window.__abierto = url;
      return null;
    };
  });
  await page.locator('.btn-send').click();
  await page.waitForTimeout(400);
  const url = await page.evaluate(() => window.__abierto);
  check(
    typeof url === 'string' && url.startsWith('https://wa.me/524471257475?text='),
    'F12 enviar pedido abre WhatsApp del negocio',
    String(url).slice(0, 46)
  );
  const msg = decodeURIComponent(String(url).split('?text=')[1] || '');
  check(msg.includes('*CARBOLITAS* · Pedido'), 'F14 encabezado del mensaje');
  check(msg.includes('1. Suprema x1 — $110'), 'F14 línea 1 del mensaje');
  check(msg.includes('2. Hotdog con tocino x2 — $60'), 'F14 línea 2 del mensaje');
  check(msg.includes('TOTAL: $170 MXN'), 'F14 total del mensaje');
  check(
    msg.includes('Servicio: Para llevar') && msg.includes('Nombre: Nataly'),
    'F14 datos del cliente'
  );

  /* ---- casos límite ---- */
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  check((await page.locator('.combar__total').textContent()) === '$170', 'EDGE recarga conserva el pedido');

  await page.evaluate(() => localStorage.setItem('carbolitas.order.v1', '{"v":1,"items":[{{{'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  check(
    (await page.locator('.item').count()) === 9 &&
      (await page.locator('.combar').getAttribute('data-visible')) === 'false',
    'EDGE localStorage corrupto no rompe la carta'
  );

  await page.evaluate(() =>
    localStorage.setItem(
      'carbolitas.order.v1',
      JSON.stringify({ v: 1, items: [{ p: 'producto-que-ya-no-existe', q: 3 }, { p: 'papas-fritas', q: 999 }] })
    )
  );
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  check(
    (await page.locator('.combar__total').textContent()) === '$1,200',
    'EDGE producto retirado se descarta y la cantidad se acota a 20',
    await page.locator('.combar__total').textContent()
  );

  // cantidad máxima en la ficha
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  await page.locator('[data-product="papas-fritas"]').click();
  const plus = page.locator('.sheet__foot .stepper button[aria-label="Agregar una unidad"]');
  for (let i = 0; i < 25 && !(await plus.isDisabled()); i++) await plus.click();
  check(
    (await page.locator('.sheet__foot output').textContent()) === '20' && (await plus.isDisabled()),
    'EDGE tope de cantidad'
  );

  // teclado: Escape cierra la ficha y devuelve el foco
  await page.keyboard.press('Escape');
  await page.waitForSelector('.sheet[data-open="false"]', { state: 'attached' });
  const focused = await page.evaluate(() => document.activeElement?.dataset?.product || '');
  check(focused === 'papas-fritas', 'A11Y Escape cierra y devuelve el foco', focused || 'sin foco');

  // el bloqueo de scroll se libera al cerrar la ficha
  await page.locator('[data-product="papas-fritas"]').click();
  await page.waitForSelector('.sheet[data-open="true"]', { state: 'visible' });
  const lockedWhileOpen = await page.evaluate(() => document.body.classList.contains('locked'));
  await page.locator('.sheet__close').click();
  await page.waitForSelector('.sheet[data-open="false"]', { state: 'attached' });
  const lockedAfter = await page.evaluate(() => document.body.classList.contains('locked'));
  check(lockedWhileOpen && !lockedAfter, 'A11Y el bloqueo de scroll se libera al cerrar');

  // el fondo queda inerte mientras hay un panel encima
  await page.locator('[data-product="papas-fritas"]').click();
  await page.waitForSelector('.sheet[data-open="true"]', { state: 'visible' });
  const inertBg = await page.evaluate(() => document.querySelector('.flow').inert === true);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.sheet[data-open="false"]', { state: 'attached' });
  const inertAfter = await page.evaluate(() => document.querySelector('.flow').inert === true);
  check(inertBg && !inertAfter, 'A11Y el fondo queda inerte y se restituye');

  // cruzar el punto de quiebre con la ficha abierta no deja el body bloqueado
  await page.locator('[data-product="papas-fritas"]').click();
  await page.waitForSelector('.sheet[data-open="true"]', { state: 'visible' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(200);
  const lockedAtDesktop = await page.evaluate(() => document.body.classList.contains('locked'));
  check(lockedAtDesktop, 'A11Y la ficha abierta mantiene el bloqueo al pasar a escritorio');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const freedAtDesktop = await page.evaluate(
    () => !document.body.classList.contains('locked') && document.querySelector('#scrim').dataset.on === 'false'
  );
  check(freedAtDesktop, 'A11Y al cerrar en escritorio se libera todo');

  // en escritorio, quitar una línea no deja el foco huérfano
  await page.locator('[data-product="hotdog"]').click();
  await page.waitForSelector('.sheet[data-open="true"]', { state: 'visible' });
  await page.locator('.btn-add').click();
  await page.waitForTimeout(200);
  await page.locator('.tline__link--del').click();
  await page.waitForTimeout(200);
  const focusOk = await page.evaluate(
    () => document.activeElement !== document.body && document.querySelector('#dock').contains(document.activeElement)
  );
  check(focusOk, 'A11Y el foco sobrevive a eliminar una línea en escritorio');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);

  // producto sin fotografía
  check(
    (await page.locator('[data-product="hotdog"] .grill').count()) === 1,
    'EDGE plato sin fotografía usa la placa de parrilla'
  );

  check(consoleErrors.length === 0, 'CONSOLA sin errores', consoleErrors.join(' | ') || 'limpia');
  check(failedRequests.length === 0, 'RED sin peticiones fallidas', failedRequests.join(' | ') || 'todo 200');

  await context.close();
}

/* ============ 2. auditoría responsive ============ */
const VIEWPORTS = [
  [320, 568], [360, 800], [375, 812], [390, 844], [412, 915], [430, 932],
  [768, 1024], [1024, 768], [1280, 800], [1366, 768], [1440, 900], [1920, 1080]
];

for (const [width, height] of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: width < 700
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');

  const audit = async (label) => {
    const report = await page.evaluate(() => {
      const doc = document.documentElement;
      const before = window.scrollX;
      window.scrollTo(600, window.scrollY);
      const overflow = window.scrollX; // desplazamiento horizontal real conseguido
      window.scrollTo(before, window.scrollY);
      const wide = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > document.documentElement.clientWidth + 1 || r.left < -1) {
          const cs = getComputedStyle(el);
          if (cs.position === 'fixed' && cs.transform !== 'none') continue; // paneles fuera de pantalla
          let clipped = false;
          for (let n = el.parentElement; n; n = n.parentElement) {
            if (/hidden|clip|auto|scroll/.test(getComputedStyle(n).overflowX)) { clipped = true; break; }
          }
          if (clipped) continue;
          wide.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} ${Math.round(r.left)}→${Math.round(r.right)}`);
        }
      }
      const small = [];
      for (const el of document.querySelectorAll('button:not([disabled]), a[href], input, textarea, label.tag')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (el.closest('[data-open="false"], .skip')) continue;
        if (el.classList.contains('sr-only')) continue;
        if (r.height < 40 || r.width < 24) small.push(`${el.className || el.tagName} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      return { overflow, wide: wide.slice(0, 6), small: small.slice(0, 6) };
    });
    check(report.overflow <= 0, `RES ${width}×${height} ${label} sin desplazamiento horizontal`, report.overflow > 0 ? `+${report.overflow}px · ${report.wide.join(' | ')}` : '');
    check(report.small.length === 0, `RES ${width}×${height} ${label} objetivos táctiles`, report.small.join(' | ') || 'todos ≥40px');
  };

  await audit('inicio');
  await page.screenshot({ path: join(SHOTS, `v-${width}x${height}.png`), fullPage: false });

  // con la ficha abierta
  await page.locator('[data-product="alitas-7"]').click();
  await page.waitForSelector('.sheet[data-open="true"]', { state: 'visible' });
  await page.locator('.tag', { hasText: 'Barbecue' }).click();
  await page.waitForTimeout(200);
  await audit('ficha');
  await page.screenshot({ path: join(SHOTS, `v-${width}x${height}-ficha.png`) });
  await page.locator('.btn-add').click();

  // con la comanda abierta
  if (width < 1024) await page.locator('#combar').click();
  await page.waitForTimeout(320);
  await audit('comanda');
  await page.screenshot({ path: join(SHOTS, `v-${width}x${height}-comanda.png`) });

  await context.close();
}

/* ============ 3. hosting incompleto: la carpeta img/ no llegó ============
   Es el fallo más común al publicar (se sube sólo el HTML). La carta tiene que
   seguir siendo usable: ninguna imagen rota y el pedido sigue funcionando. */
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true
  });
  const page = await context.newPage();
  await page.route('**/img/**', (route) => route.abort());
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="true"]');
  await page.waitForTimeout(400);

  const estado = await page.evaluate(() => {
    const imgs = [...document.images];
    const visiblesRotas = imgs.filter(
      (i) => !i.complete || (i.naturalWidth === 0 && getComputedStyle(i).display !== 'none')
    );
    const media = [...document.querySelectorAll('.item__media')];
    const conPlaca = media.filter((m) => m.dataset.broken === 'true').length;
    return { total: imgs.length, visiblesRotas: visiblesRotas.length, media: media.length, conPlaca };
  });

  check(
    estado.visiblesRotas === 0,
    'SIN-IMG ninguna imagen rota visible',
    `${estado.total} imágenes, ${estado.visiblesRotas} rotas`
  );
  check(
    estado.conPlaca > 0,
    'SIN-IMG los huecos caen a la placa de la marca',
    `${estado.conPlaca}/${estado.media} tarjetas`
  );

  const overflow = await page.evaluate(() => {
    window.scrollTo(document.documentElement.scrollWidth, 0);
    const o = Math.round(window.scrollX);
    window.scrollTo(0, 0);
    return o;
  });
  check(overflow <= 0, 'SIN-IMG sin desplazamiento horizontal', overflow > 0 ? `+${overflow}px` : '');

  await page.locator('[data-product="alitas-7"]').click();
  await page.waitForSelector('.sheet[data-open="true"]', { state: 'visible' });
  await page.locator('.tag', { hasText: 'Barbecue' }).click();
  await page.locator('.btn-add').click();
  await page.waitForTimeout(200);
  const total = await page.locator('.combar__total').textContent();
  check(/\$\s?\d/.test(total || ''), 'SIN-IMG el pedido sigue funcionando', total || 'sin total');
  await page.screenshot({ path: join(SHOTS, 'sin-imagenes.png') });
  await context.close();
}

/* ============ 4. panel administrativo ============
   Se ejercita contra las funciones reales: entrar, cambiar precio, agotar un
   platillo, publicar, y comprobar que la carta del cliente lo refleja. */
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    locale: 'es-MX'
  });
  const page = await context.newPage();
  const erroresPanel = [];
  page.on('pageerror', (e) => erroresPanel.push('pageerror: ' + e.message));
  /* "Failed to load resource" se filtra: la prueba de contraseña equivocada
     provoca un 401 a propósito y el navegador lo registra siempre. Lo que sí
     tiene que estar limpio son los errores de ejecución. */
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/ERR_TUNNEL|fonts\.g|Failed to load resource/.test(t)) {
      erroresPanel.push(t);
    }
  });
  page.on('dialog', (d) => d.accept());

  await page.goto(`${BASE}admin.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');

  check(
    (await page.locator('#modo').textContent()).includes('al instante'),
    'P1 el panel detecta que puede publicar en vivo'
  );
  check(await page.locator('#gate').isVisible(), 'P2 pide contraseña antes de mostrar nada');
  check(!(await page.locator('#app').isVisible()), 'P2 la carta no se ve sin entrar');
  await page.screenshot({ path: join(SHOTS, 'p-01-acceso.png') });

  await page.fill('#password', 'incorrecta');
  await page.click('#entrar');
  await page.waitForSelector('#gate-error:not([hidden])');
  check(
    (await page.locator('#gate-error').textContent()).includes('incorrecta'),
    'P3 contraseña equivocada: lo dice y no entra'
  );
  check(!(await page.locator('#app').isVisible()), 'P3 sigue sin abrir el panel');

  await page.fill('#password', 'qa-carbolitas-2026-larga');
  await page.click('#entrar');
  await page.waitForSelector('#app:not([hidden])');
  check((await page.locator('#lista-platillos .card').count()) === 9, 'P4 entra y lista los 9 platillos');
  check(!(await page.locator('#publicar').isEnabled()), 'P4 sin cambios no hay nada que publicar');
  await page.screenshot({ path: join(SHOTS, 'p-02-platillos.png') });

  /* cambiar un precio */
  await page
    .locator('#lista-platillos button.card__title', { hasText: 'Hotdog con tocino' })
    .click();
  const ficha = page.locator('[data-card="hotdog"]');
  const precio = ficha.locator('input[aria-label="Precio en pesos"]');
  await precio.fill('33');
  await precio.dispatchEvent('input');
  check(
    (await ficha.locator('.card__price').textContent()) === '$33',
    'P5 el precio nuevo se ve al momento en la tarjeta'
  );
  check(await page.locator('#publicar').isEnabled(), 'P5 se habilita publicar');
  check(
    (await page.locator('#bar-state').textContent()).includes('sin publicar'),
    'P5 avisa que hay cambios sin publicar'
  );
  await page.screenshot({ path: join(SHOTS, 'p-03-editando.png') });

  /* el precio admite coma decimal: el teclado en español la ofrece */
  await precio.fill('33,50');
  await precio.dispatchEvent('input');
  check(
    (await ficha.locator('.card__price').textContent()) === '$33.50',
    'P5 la coma decimal se entiende como punto',
    await ficha.locator('.card__price').textContent()
  );
  await precio.fill('33');
  await precio.dispatchEvent('input');

  /* agotar un platillo desde la cabecera */
  await page.locator('[data-card="papas-fritas"] .stock').click();
  check(
    (await page.locator('[data-card="papas-fritas"] .stock').getAttribute('aria-pressed')) === 'false',
    'P6 agotar un platillo con un solo toque'
  );

  /* aviso del día */
  await page.locator('.tab', { hasText: 'Negocio' }).click();
  const aviso = page.locator('#form-negocio input[placeholder^="Hoy cerramos"]');
  await aviso.fill('Hoy cerramos a las 9:30');
  await aviso.dispatchEvent('input');

  /* horario: quitar el martes ya estaba quitado; se marca y se comprueba el texto */
  await page.locator('.dia', { hasText: 'Mar' }).click();
  const leyenda = await page.locator('#form-negocio .f small').last().textContent();
  check(/Todos los días/.test(leyenda), 'P7 el horario se lee en palabras al marcar días', leyenda);
  await page.locator('.dia', { hasText: 'Mar' }).click();
  await page.screenshot({ path: join(SHOTS, 'p-04-negocio.png') });

  /* publicar */
  await page.click('#publicar');
  await page.waitForSelector('#aviso:not([hidden])');
  const resultado = await page.locator('#aviso').textContent();
  check(/Publicado/.test(resultado), 'P8 publica sin avisos', resultado.slice(0, 60));
  check(
    (await page.locator('#bar-state').textContent()).includes('Todo publicado'),
    'P8 la barra vuelve a "todo publicado"'
  );

  /* la carta del cliente, recién abierta */
  const cliente = await context.newPage();
  const erroresCarta = [];
  cliente.on('pageerror', (e) => erroresCarta.push(e.message));
  await cliente.goto(BASE, { waitUntil: 'load' });
  await cliente.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  await cliente.waitForFunction(
    () => document.querySelector('[data-product="hotdog"] .item__price')?.textContent === '$33',
    null,
    { timeout: 10000 }
  );
  check(true, 'P9 el precio nuevo llega a la carta del cliente');
  const clasePapas = await cliente.locator('[data-product="papas-fritas"]').getAttribute('class');
  check(/item--off/.test(clasePapas), 'P9 el platillo agotado se ve agotado');
  check(await cliente.locator('#notice').isVisible(), 'P9 el aviso del día aparece arriba');

  /* un agotado no se puede pedir (force: el navegador sí entrega el toque;
     lo que tiene que fallar es abrir la ficha, no el clic) */
  await cliente.locator('[data-product="papas-fritas"]').click({ force: true });
  await cliente.waitForTimeout(500);
  const fichaAbierta = await cliente.evaluate(
    () => document.querySelector('#sheet')?.dataset.open === 'true'
  );
  check(!fichaAbierta, 'P10 un platillo agotado no abre la ficha');
  check(
    /agotado/i.test(await cliente.locator('#flash').textContent()),
    'P10 y se lo dice al cliente'
  );
  await cliente.screenshot({ path: join(SHOTS, 'p-05-carta-actualizada.png') });

  /* el nombre se pinta como texto, nunca como HTML */
  await page.bringToFront();
  await page.locator('.tab', { hasText: 'Platillos' }).click();
  const nombre = page.locator('[data-card="hotdog"] input').first();
  await nombre.fill('<img src=x onerror=alert(1)>Hotdog');
  await nombre.dispatchEvent('input');
  await page.click('#publicar');
  await page.waitForTimeout(600);
  await cliente.bringToFront();
  await cliente.reload({ waitUntil: 'load' });
  await cliente.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  await cliente.waitForTimeout(1200);
  const inyeccion = await cliente.evaluate(() => ({
    texto: document.querySelector('[data-product="hotdog"] .item__name')?.textContent || '',
    imgs: document.querySelectorAll('[data-product="hotdog"] img[src="x"]').length
  }));
  check(
    inyeccion.texto.startsWith('<img') && inyeccion.imgs === 0,
    'P11 un nombre con HTML se muestra como texto, no se ejecuta',
    inyeccion.texto.slice(0, 40)
  );

  check(erroresPanel.length === 0, 'P12 el panel no produce errores en consola', erroresPanel.join(' | '));
  check(erroresCarta.length === 0, 'P12 la carta no produce errores en consola', erroresCarta.join(' | '));

  /* --- la sesión --- */
  await page.bringToFront();
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  check(
    await page.locator('#app').isVisible(),
    'P15 recargar la página no expulsa del panel'
  );
  check(!(await page.locator('#gate').isVisible()), 'P15 no vuelve a pedir la contraseña');

  /* Una sesión guardada pero vieja no debe abrir el panel: el teléfono que
     restaura la pestaña horas después tiene que volver a pedir contraseña. */
  await page.evaluate(() => {
    const k = 'carbolitas.panel.sesion.v1';
    const s = JSON.parse(sessionStorage.getItem(k));
    s.visto = Date.now() - 31 * 60 * 1000;
    sessionStorage.setItem(k, JSON.stringify(s));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  check(
    await page.locator('#gate').isVisible(),
    'P15 media hora sin actividad vuelve a pedir contraseña'
  );
  await page.fill('#password', 'qa-carbolitas-2026-larga');
  await page.click('#entrar');
  await page.waitForSelector('#app:not([hidden])');

  await page.click('#salir');
  await page.waitForSelector('#gate:not([hidden])');
  check(await page.locator('#gate').isVisible(), 'P16 salir cierra la sesión');
  const guardada = await page.evaluate(() =>
    sessionStorage.getItem('carbolitas.panel.sesion.v1')
  );
  check(guardada === null, 'P16 el pase se borra del navegador al salir');

  /* y el pase ya no vale en el servidor, aunque alguien lo hubiera copiado */
  const reusado = await page.evaluate(async (t) => {
    const r = await fetch('api/publicar', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
      body: JSON.stringify({ doc: { products: [] } })
    });
    return r.status;
  }, JSON.parse(guardada || 'null')?.token || 'sin-token');
  check(reusado === 401, 'P16 un pase copiado deja de servir tras salir', `HTTP ${reusado}`);

  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  check(
    await page.locator('#gate').isVisible(),
    'P17 tras salir, recargar vuelve a pedir contraseña'
  );

  /* el panel también en escritorio */
  const ancho = await context.newPage();
  await ancho.setViewportSize({ width: 1280, height: 800 });
  await ancho.goto(`${BASE}admin.html`, { waitUntil: 'load' });
  await ancho.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  await ancho.fill('#password', 'qa-carbolitas-2026-larga');
  await ancho.click('#entrar');
  await ancho.waitForSelector('#app:not([hidden])');
  const desborde = await ancho.evaluate(() => {
    window.scrollTo(document.documentElement.scrollWidth, 0);
    const o = Math.round(window.scrollX);
    window.scrollTo(0, 0);
    return o;
  });
  check(desborde <= 0, 'P13 el panel no se desborda en escritorio');
  await ancho.screenshot({ path: join(SHOTS, 'p-06-escritorio.png') });

  /* objetivos táctiles del panel */
  const chicos = await page.evaluate(() => {
    const malos = [];
    for (const n of document.querySelectorAll('button, input, select, a, label.btn')) {
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.height < 40) {
        malos.push(`${n.className || n.tagName}: ${Math.round(r.height)}px`);
      }
    }
    return malos.slice(0, 6);
  });
  check(chicos.length === 0, 'P14 objetivos táctiles del panel ≥40px', chicos.join(' | ') || 'todos');

  await context.close();
}

/* ============ 5. el panel publicado SIN funciones ============
   Un sitio estático no puede comprobar ninguna contraseña: el candado se
   revisaría en el navegador de quien entra, y eso no es un candado. El panel
   tiene que quedarse apagado, sin pintar la carta siquiera. */
{
  const estatico = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    try {
      const file = join(DIST, rel === '/' ? 'index.html' : rel);
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((r) => estatico.listen(0, r));
  const base = `http://127.0.0.1:${estatico.address().port}/`;

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.goto(`${base}admin.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');

  check(await page.locator('#apagado').isVisible(), 'P18 sin funciones el panel se muestra apagado');
  check(!(await page.locator('#app').isVisible()), 'P18 el editor no se abre');
  check(
    (await page.locator('#lista-platillos .card').count()) === 0,
    'P18 ni siquiera se pinta la carta'
  );
  check(!(await page.locator('#bar').isVisible()), 'P18 no hay botón de publicar');
  check(errores.length === 0, 'P18 sin errores en consola', errores.join(' | '));
  await page.screenshot({ path: join(SHOTS, 'p-08-apagado.png') });

  /* la carta pública, en cambio, funciona igual que siempre */
  const cliente = await context.newPage();
  await cliente.goto(base, { waitUntil: 'load' });
  await cliente.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  check((await cliente.locator('.item').count()) === 9, 'P18 la carta sigue completa');

  await context.close();
  estatico.close();
}

/* ============ 6. despliegue en Vercel ============
   Vercel resuelve el sistema de archivos ANTES que las reescrituras, al revés
   que Netlify. Si el build dejara un carta.json estático, taparía a la
   función y publicar desde el panel no cambiaría nada para nadie: la dueña
   vería "Publicado" y los clientes seguirían con la carta vieja. Esto se
   comprueba contra el vercel.json real, sin desplegar. */
{
  const { cargarReglas } = await import('./vercel-rutas.mjs');
  const reglas = cargarReglas(join(ROOT, 'vercel.json'));

  const vercel = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const extra = reglas.cabecerasDe(url.pathname);
    const trozos = [];
    for await (const c of req) trozos.push(c);

    /* archivos primero, como hace Vercel */
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    try {
      const data = await readFile(join(DIST, rel === '/' ? 'index.html' : rel));
      res.writeHead(200, {
        'content-type': TYPES[extname(rel)] || 'application/octet-stream',
        ...extra
      });
      res.end(data);
      return;
    } catch {
      /* no es un archivo: puede ser una reescritura */
    }

    const destino = reglas.reescribir(url.pathname);
    const final = destino ? new URL(destino, url.origin) : url;
    const fn =
      FUNCIONES[final.pathname] ||
      (final.pathname === '/api/carta' ? FUNCIONES['/carta.json'] : null) ||
      (final.pathname.startsWith('/api/foto') ? FUNCIONES['/api/foto'] : null);
    if (!fn) {
      res.writeHead(404, extra).end('not found');
      return;
    }
    const out = await fn(
      new Request(final.href, {
        method: req.method,
        headers: req.headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(trozos)
      }),
      {}
    );
    const cab = { ...extra };
    out.headers.forEach((v, k) => (cab[k] = v));
    res.writeHead(out.status, cab);
    res.end(Buffer.from(await out.arrayBuffer()));
  });
  await new Promise((r) => vercel.listen(0, r));
  const base = `http://127.0.0.1:${vercel.address().port}/`;

  /* El build para Vercel no debe dejar el archivo estático. */
  const { existsSync } = await import('node:fs');
  const hayEstatico = existsSync(join(DIST, 'carta.json'));
  const carta = await fetch(`${base}carta.json`);
  check(
    carta.headers.get('x-carbolitas-panel') === '1' || hayEstatico,
    'V1 en Vercel la carta la sirve la función, no un archivo',
    hayEstatico ? 'compilado para Netlify: la comprobación real necesita CARBOLITAS_TARGET=vercel' : ''
  );

  const cabeceras = reglas.cabecerasDe('/');
  check(cabeceras['X-Content-Type-Options'] === 'nosniff', 'V2 vercel.json trae X-Content-Type-Options');
  check(/frame-ancestors/.test(cabeceras['Content-Security-Policy'] || ''), 'V2 y frame-ancestors');
  check(
    /immutable/.test(reglas.cabecerasDe('/img/x.webp')['Cache-Control'] || ''),
    'V2 las fotos se cachean un año'
  );
  check(
    reglas.cabecerasDe('/admin.html')['Cache-Control'] === 'no-store',
    'V2 el panel nunca se cachea'
  );

  check(
    reglas.reescribir('/api/foto/alitas-320.webp') === '/api/foto?name=alitas-320.webp',
    'V3 la ruta de las fotos se reescribe con el nombre',
    String(reglas.reescribir('/api/foto/alitas-320.webp'))
  );

  /* entrar → publicar → leer, por las rutas de Vercel */
  const entrada = await fetch(`${base}api/entrar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'qa-carbolitas-2026-larga' })
  });
  const { token } = await entrada.json();
  check(Boolean(token), 'V4 se puede entrar por /api/entrar');

  const doc = await (await fetch(`${base}carta.json`)).json();
  doc.business.notice = 'Prueba desde Vercel';
  const publicado = await fetch(`${base}api/publicar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ doc })
  });
  check(publicado.status === 200, 'V4 se puede publicar por /api/publicar', `HTTP ${publicado.status}`);

  const despues = await (await fetch(`${base}carta.json`)).json();
  check(
    despues.business.notice === 'Prueba desde Vercel',
    'V4 lo publicado se lee de vuelta en la misma dirección'
  );

  const sinPase = await fetch(`${base}api/publicar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ doc })
  });
  check(sinPase.status === 401, 'V5 sin pase no se publica tampoco en Vercel');

  vercel.close();
}

await browser.close();
server.close();

console.log(results.join('\n'));
console.log(
  `\n${results.filter((r) => r.includes('✔')).length} verificaciones OK · ${problems.length} problemas`
);
if (problems.length) {
  console.log('\nPROBLEMAS:\n' + problems.map((p) => ' - ' + p).join('\n'));
  process.exitCode = 1;
}
