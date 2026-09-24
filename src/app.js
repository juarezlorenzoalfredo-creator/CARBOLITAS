/** Punto de entrada. El catálogo llega ya renderizado en el HTML;
 *  aquí se conecta la interacción (delegación de eventos) y, si el sitio
 *  tiene panel publicado, se repinta con la carta vigente. */
import { applyBusiness, BUSINESS } from './config.js';
import { normalizeDoc } from './lib/document.js';
import { createCatalog } from './lib/catalog.js';
import { createCart } from './lib/cart.js';
import { money } from './lib/format.js';
import { fetchCarta, prettyPhone } from './lib/live.js';
import { $, $$, clear, h } from './ui/dom.js';
import { categorySection, salsasPanel } from './ui/render.js';
import { createSheet } from './ui/sheet.js';
import { createTicket, isDesktopViewport } from './ui/ticket.js';
import { openStatus } from './lib/schedule.js';

/* BASE_DOC e IMAGE_MANIFEST los inyecta el build desde src/data/*.json */

function boot() {
  let catalog = createCatalog(BASE_DOC);
  const cart = createCart(catalog);

  const scrim = $('#scrim');
  const combar = $('#combar');
  const cartBtn = $('#cartbtn');
  const cartDot = $('#cartdot');
  const drawer = $('#drawer');
  const menuBtn = $('#menubtn');
  const waBtn = $('#wabtn');
  const waLabel = $('#wa-label');
  const combarCount = $('.combar__count', combar);
  const combarTotal = $('.combar__total', combar);
  const flashNode = $('#flash');
  const live = $('#live');
  let flashTimer = 0;

  const stillMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function pulseCount() {
    if (stillMotion.matches || !combarCount.animate) return;
    combarCount.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.22)' }, { transform: 'scale(1)' }],
      { duration: 420, easing: 'cubic-bezier(0.22,0.68,0.28,1)' }
    );
  }

  function flash(message) {
    flashNode.textContent = message;
    flashNode.dataset.on = 'true';
    live.textContent = message;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashNode.dataset.on = 'false';
    }, 2600);
  }

  /**
   * Único dueño del estado "hay un panel encima": velo, bloqueo de scroll e
   * inercia del fondo. Ni la ficha ni la comanda tocan el body por su cuenta.
   */
  const backdrop = [$('.topbar'), $('.hero'), $('.railnav'), $('.flow'), combar];
  const dock = $('#dock');
  const drawerOpen = () => drawer.dataset.open === 'true';
  function syncOverlays() {
    const ticketAsPanel = ticket.isOpen && !isDesktopViewport();
    const covered = sheet.isOpen || ticketAsPanel || drawerOpen();
    scrim.dataset.on = String(covered);
    document.body.classList.toggle('locked', covered);
    for (const node of backdrop) if (node) node.inert = covered;
    dock.inert = sheet.isOpen || drawerOpen();
  }

  const sheet = createSheet({
    node: $('#sheet'),
    images: IMAGE_MANIFEST,
    onClose: syncOverlays,
    onSubmit({ product, selection, qty, note, editKey }) {
      if (editKey) {
        cart.replace(editKey, product, selection, qty, note);
        flash(`${product.name} actualizada.`);
      } else {
        const added = cart.add(product, selection, qty, note);
        if (!added) {
          flash('Tu pedido ya está lleno.');
          return;
        }
        flash(`${qty} × ${product.name} en tu pedido.`);
        pulseCount();
      }
    }
  });

  const ticket = createTicket({
    node: dock,
    cart,
    onFlash: flash,
    onToggle: syncOverlays,
    onMode: (id) =>
      $$('.segmented__btn').forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.mode === id))
      ),
    onEdit(line) {
      ticket.close();
      openSheet(line.product, {
        selection: line.selection,
        qty: line.qty,
        note: line.note,
        editKey: line.key
      });
    }
  });

  function openSheet(product, options) {
    ticket.close();
    sheet.open(product, options);
    syncOverlays();
  }

  /* --- catálogo: un solo listener para todas las fichas --- */
  const catalogNode = $('#catalog');
  catalogNode.addEventListener('click', (event) => {
    const button = event.target.closest('[data-product]');
    if (!button) return;
    const product = catalog.byId.get(button.dataset.product);
    if (!product) return;
    if (product.available === false) {
      flash(`${product.name} está agotado por hoy.`);
      return;
    }
    openSheet(product, {});
  });

  /* --- accesos al pedido: barra inferior e icono de la barra superior --- */
  const abrirPedido = () => {
    if (sheet.isOpen) return;
    closeDrawer();
    if (isDesktopViewport()) {
      dock.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    ticket.open();
  };
  combar.addEventListener('click', abrirPedido);
  cartBtn.addEventListener('click', abrirPedido);

  /* --- menú lateral --- */
  function openDrawer() {
    drawer.dataset.open = 'true';
    menuBtn.setAttribute('aria-expanded', 'true');
    syncOverlays();
    requestAnimationFrame(() => $('#drawerclose').focus());
  }
  function closeDrawer() {
    if (!drawerOpen()) return;
    drawer.dataset.open = 'false';
    menuBtn.setAttribute('aria-expanded', 'false');
    syncOverlays();
    menuBtn.focus();
  }
  menuBtn.addEventListener('click', () => (drawerOpen() ? closeDrawer() : openDrawer()));
  $('#drawerclose').addEventListener('click', closeDrawer);
  drawer.addEventListener('click', (event) => {
    const target = event.target.closest('[data-target]');
    if (!target) return;
    closeDrawer();
    document.getElementById(target.dataset.target)?.scrollIntoView({ block: 'start' });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drawerOpen()) closeDrawer();
  });

  /* --- segmentado de la portada: refleja el modo del pedido --- */
  document.addEventListener('click', (event) => {
    const button = event.target.closest('.segmented__btn');
    if (button) ticket.setMode(button.dataset.mode);
  });

  /* --- bloque de WhatsApp --- */
  waBtn.addEventListener('click', () => ticket.send());

  scrim.addEventListener('click', () => {
    if (sheet.isOpen) sheet.close();
    else if (drawerOpen()) closeDrawer();
    else ticket.close();
    syncOverlays();
  });

  /* --- estado del pedido --- */
  function paintOrder(state) {
    combar.dataset.visible = String(!state.isEmpty);
    combarCount.textContent = String(state.count);
    combarTotal.textContent = money(state.subtotal);
    cartDot.textContent = String(state.count);
    cartDot.dataset.on = String(!state.isEmpty);
    waLabel.textContent = state.isEmpty
      ? 'Pedir por WhatsApp'
      : `Enviar pedido · ${money(state.subtotal)}`;
    const etiqueta = `Ver pedido: ${state.count} ${
      state.count === 1 ? 'artículo' : 'artículos'
    }, ${money(state.subtotal)}`;
    combar.setAttribute('aria-label', etiqueta);
    cartBtn.setAttribute('aria-label', state.isEmpty ? 'Ver pedido' : etiqueta);
  }

  cart.subscribe((state) => {
    ticket.render(state);
    paintOrder(state);
  });
  const initial = cart.getState();
  ticket.render(initial);
  paintOrder(initial);

  /* --- rail de categorías: navegación + sección activa --- */
  const rail = $('#rail');
  rail.addEventListener('click', (event) => {
    const button = event.target.closest('[data-target]');
    if (!button) return;
    document
      .getElementById(button.dataset.target)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  let spy = null;
  function observarSecciones() {
    if (spy) spy.disconnect();
    const sections = $$('.cat');
    if (!('IntersectionObserver' in window) || !sections.length) return;
    const visible = new Set();
    spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        });
        const botones = $$('.railnav__btn');
        const current =
          sections.map((s) => s.id).find((id) => visible.has(id)) ||
          botones.find((b) => b.getAttribute('aria-current') === 'true')?.dataset.target;
        botones.forEach((b) =>
          b.setAttribute('aria-current', String(b.dataset.target === current))
        );
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: 0 }
    );
    sections.forEach((section) => spy.observe(section));
  }
  observarSecciones();

  /* --- abierto / cerrado, calculado en la hora del local --- */
  const statusNode = $('#status');
  function pintarEstado() {
    if (!statusNode) return;
    const { open, label } = openStatus();
    /* Sin horario configurado no se afirma nada: dejar el letrero anterior
       sería decirle al cliente una hora de apertura que ya no existe. */
    statusNode.hidden = !label;
    if (!label) return;
    statusNode.textContent = label;
    statusNode.dataset.open = String(open);
  }
  pintarEstado();
  setInterval(pintarEstado, 60000);

  /* ==================================================================
     Carta publicada desde el panel
     ================================================================== */

  /**
   * Rehace la lista de platillos, el rail y el menú lateral.
   *
   * Se construye todo aparte y sólo al final se cambia lo que está en
   * pantalla: si algo fallara a mitad, el cliente sigue viendo la carta
   * anterior completa en vez de una página en blanco.
   */
  function pintarCatalogo() {
    const cats = catalog.categories.filter((c) => c.products.length);

    const platillos = document.createDocumentFragment();
    cats.forEach((c, i) => platillos.append(categorySection(IMAGE_MANIFEST, c, i, () => {})));

    const pestanas = document.createDocumentFragment();
    cats.forEach((c, i) =>
      pestanas.append(
        h('button.railnav__btn', {
          type: 'button',
          'aria-current': String(i === 0),
          dataset: { target: `cat-${c.id}` },
          text: c.name
        })
      )
    );

    const atajos = document.createDocumentFragment();
    cats.forEach((c) =>
      atajos.append(
        h('button', { type: 'button', dataset: { target: `cat-${c.id}` }, text: c.name })
      )
    );

    const panelNuevo = salsasPanel(catalog);

    clear(catalogNode);
    catalogNode.append(platillos);
    clear(rail);
    rail.append(pestanas);
    const drawerNav = $('#drawer-nav');
    clear(drawerNav);
    drawerNav.append(atajos);

    const panelViejo = $('.salsas-panel');
    if (panelViejo && panelNuevo) panelViejo.replaceWith(panelNuevo);
    else if (panelViejo) panelViejo.remove();
    else if (panelNuevo) catalogNode.after(panelNuevo);

    observarSecciones();
  }

  /** Rehace dirección, horario, teléfono y aviso del día. */
  function pintarNegocio() {
    const tel = prettyPhone(BUSINESS.phone);
    const datos = $('#place-data');
    if (datos) {
      clear(datos);
      if (BUSINESS.address) {
        const span = h('span', { text: `${BUSINESS.address} ` });
        if (BUSINESS.mapsUrl) {
          span.append(
            h('a', {
              href: BUSINESS.mapsUrl,
              target: '_blank',
              rel: 'noopener noreferrer',
              text: 'Cómo llegar'
            })
          );
        }
        datos.append(h('li', {}, [h('b', { text: 'Dónde' }), span]));
      }
      for (const linea of BUSINESS.hours) {
        datos.append(
          h('li', {}, [
            h('b', { text: 'Horario' }),
            h('span', { text: `${linea.days}: ${linea.hours}` })
          ])
        );
      }
      if (BUSINESS.phone) {
        datos.append(
          h('li', {}, [
            h('b', { text: 'Pedidos' }),
            h('span', {}, [h('a', { href: `tel:+52${BUSINESS.phone}`, text: tel })])
          ])
        );
      }
    }

    const pie = $('#drawer-foot');
    if (pie) {
      clear(pie);
      pie.append(h('span', { text: BUSINESS.address }));
      if (BUSINESS.phone) pie.append(h('a', { href: `tel:+52${BUSINESS.phone}`, text: tel }));
      if (BUSINESS.mapsUrl) {
        pie.append(
          h('a', {
            href: BUSINESS.mapsUrl,
            target: '_blank',
            rel: 'noopener noreferrer',
            text: 'Cómo llegar'
          })
        );
      }
    }

    const dirPie = $('#foot-address');
    if (dirPie) dirPie.textContent = BUSINESS.address;
    const numero = $('#wa-number');
    if (numero) numero.textContent = tel;

    const aviso = $('#notice');
    if (aviso) {
      aviso.textContent = BUSINESS.notice || '';
      aviso.hidden = !BUSINESS.notice;
    }
    pintarEstado();
  }

  /**
   * Aplica la carta publicada. Se hace en un solo paso para que el cliente no
   * vea precios viejos junto a precios nuevos.
   */
  function aplicarDoc(doc) {
    Object.assign(IMAGE_MANIFEST, doc.images || {});
    catalog = createCatalog(doc);
    applyBusiness(doc.business);
    pintarCatalogo();
    pintarNegocio();
    const cambio = cart.setCatalog(catalog);
    if (cambio) flash('Tu pedido se actualizó con la carta de hoy.');
  }

  async function sincronizar() {
    const remoto = await fetchCarta();
    if (!remoto) return;
    const { doc } = normalizeDoc(remoto, { images: Object.keys(IMAGE_MANIFEST) });
    if (!doc.products.length) return;
    if (doc.updatedAt === BASE_DOC.updatedAt) return;
    aplicarDoc(doc);
  }
  /* La carta compilada ya está en pantalla: que la sincronización falle no
     puede dejar al cliente sin nada que pedir. */
  sincronizar().catch(() => {});

  document.documentElement.dataset.ready = 'true';

  /* --- red caída o archivo ausente: nunca un icono de imagen rota --- */
  const MEDIA = '.item__media, .sheet__media, .place__media, .hero__bg';
  function marcarRota(node) {
    if (!node || node.tagName !== 'IMG') return;
    node.dataset.broken = 'true';
    const holder = node.closest(MEDIA);
    if (holder) holder.dataset.broken = 'true';
  }
  window.addEventListener('error', (event) => marcarRota(event.target), true);
  /* El HTML llega renderizado del build, así que algunas imágenes ya pueden
     haber fallado antes de que este script existiera: se revisan a mano. */
  function barrerImagenes() {
    for (const img of document.images) {
      if (img.complete && img.naturalWidth === 0) marcarRota(img);
    }
  }
  barrerImagenes();
  window.addEventListener('load', barrerImagenes, { once: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
