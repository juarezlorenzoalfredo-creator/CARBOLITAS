/** La comanda: el pedido impreso. Hoja modal en móvil, columna fija en escritorio. */
import { BUSINESS, LIMITS } from '../config.js';
import { describeSelection } from '../lib/catalog.js';
import { money } from '../lib/format.js';
import { buildOrderText, buildWhatsappUrl } from '../lib/order.js';
import { sanitizeText } from '../lib/cart.js';
import { clear, h, trapFocus } from './dom.js';

export const DESKTOP = '(min-width: 64rem)';
export const isDesktopViewport = () => window.matchMedia(DESKTOP).matches;

export function createTicket({ node, cart, onEdit, onFlash, onToggle, onMode }) {
  const isDesktop = isDesktopViewport;
  const customer = { name: '', mode: BUSINESS.serviceModes[0]?.id || '' };
  let lastFocus = null;
  /** La lista se reconstruye en cada cambio: aquí se recuerda dónde estaba el foco. */
  let pendingFocus = null;

  const body = h('div.ticket__body');
  const title = h('h2', { id: 'ticket-title', text: 'Tu pedido', tabindex: '-1' });
  const totalOut = h('span', { class: 'price', text: money(0) });
  const closeBtn = h('button.ticket__close', {
    type: 'button',
    'aria-label': 'Cerrar pedido',
    text: '✕',
    on: { click: () => close() }
  });

  const nameInput = h('input', {
    id: 'cust-name',
    type: 'text',
    autocomplete: 'name',
    maxlength: LIMITS.maxNameLength,
    placeholder: 'Tu nombre',
    on: {
      input: (e) => {
        customer.name = e.target.value;
      }
    }
  });

  /** Icono de WhatsApp; se construye como SVG real, sin innerHTML. */
  function waIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const d of [
      'M3.6 20.4 4.9 16.6A8.5 8.5 0 1 1 8.1 19.6l-4.5.8Z',
      'M9.1 9.3c.2-.5.5-.5.8-.5h.5c.2 0 .4 0 .6.4l.7 1.7c0 .2 0 .4-.1.5l-.5.6c-.2.2-.2.3-.1.5.4.8 1.5 1.9 2.8 2.5.2.1.4.1.5-.1l.5-.6c.2-.2.4-.2.6-.1l1.6.8c.3.1.4.3.3.6-.2.7-1 1.4-1.7 1.5-1.9.2-5.1-2.2-6-4.5-.4-1-.6-2.2-.5-3.3Z'
    ]) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
  }


  /** El modo de servicio vive aquí; la portada sólo lo refleja. */
  function setMode(id) {
    if (!BUSINESS.serviceModes.some((m) => m.id === id)) return;
    customer.mode = id;
    modeButtons.forEach((b, i) =>
      b.setAttribute('aria-pressed', String(BUSINESS.serviceModes[i].id === id))
    );
    onMode?.(id);
  }

  const modeButtons = BUSINESS.serviceModes.map((mode) =>
    h('button.mode', {
      type: 'button',
      text: mode.label,
      'aria-pressed': String(customer.mode === mode.id),
      on: { click: () => setMode(mode.id) }
    })
  );

  const sendBtn = h('button.btn-send', { type: 'button', on: { click: send } }, [
    waIcon(),
    h('span', { text: 'Enviar por WhatsApp' })
  ]);

  const fields = h('div.ticket__fields', {}, [
    h('div.field', {}, [h('label', { for: 'cust-name', text: 'Nombre' }), nameInput]),
    h('div.field', {}, [
      h('span.field__label', { class: 'sr-only', id: 'mode-label', text: 'Servicio' }),
      h('label', { 'aria-hidden': 'true', text: 'Servicio' }),
      h('div.modes', { role: 'group', 'aria-labelledby': 'mode-label' }, modeButtons)
    ])
  ]);

  const foot = h('div.ticket__foot', {}, [
    h('div.ticket__total', {}, [h('span', { text: 'Total' }), totalOut]),
    fields,
    sendBtn,
    BUSINESS.whatsapp
      ? null
      : h('p.ticket__note', {
          text: 'Envío por WhatsApp pendiente de configurar · el pedido se copia al portapapeles.'
        })
  ]);

  node.append(
    h('div.ticket', {}, [
      h('div.ticket__head', {}, [
        title,
        h('span.ticket__meta', { text: BUSINESS.name }),
        closeBtn
      ]),
      body,
      foot
    ])
  );
  node.setAttribute('aria-labelledby', 'ticket-title');
  node.setAttribute('role', 'region');
  node.dataset.open = 'false';

  function lineNode(line) {
    const opts = describeSelection(line.product, line.selection)
      .map((g) => g.labels.join(', '))
      .filter(Boolean);
    if (line.note) opts.push(`Nota: ${line.note}`);

    const step = (delta, action, label, symbol, disabled) =>
      h('button', {
        type: 'button',
        text: symbol,
        'aria-label': `${label} de ${line.product.name}`,
        disabled: disabled || null,
        dataset: { focus: `${line.key}|${action}` },
        on: {
          click: () => {
            pendingFocus = { key: line.key, action };
            cart.setQty(line.key, line.qty + delta);
          }
        }
      });
    const dec = step(-1, 'dec', 'Quitar una unidad', '−', false);
    const inc = step(1, 'inc', 'Agregar una unidad', '+', line.qty >= LIMITS.maxQty);

    return h('div.tline', {}, [
      h('span.tline__name', { text: `${line.qty}× ${line.product.name}` }),
      h('span.tline__price', { text: money(line.total) }),
      opts.length ? h('span.tline__opts', { text: opts.join(' · ') }) : null,
      h('div.tline__tools', {}, [
        h('div.stepper', {}, [dec, h('output', { text: String(line.qty) }), inc]),
        h('button.tline__link', {
          type: 'button',
          text: 'Editar',
          'aria-label': `Editar ${line.product.name}`,
          on: { click: () => onEdit(line) }
        }),
        h('button.tline__link.tline__link--del', {
          type: 'button',
          text: 'Quitar',
          'aria-label': `Quitar ${line.product.name} del pedido`,
          on: {
            click: () => {
              pendingFocus = { key: null, action: 'removed' };
              cart.remove(line.key);
            }
          }
        })
      ])
    ]);
  }

  function render(state) {
    clear(body);
    if (state.isEmpty) {
      body.append(
        h('p.ticket__empty', { text: 'Tu pedido está vacío. Elige algo de la carta.' })
      );
    } else {
      state.lines.forEach((line) => body.append(lineNode(line)));
    }
    totalOut.textContent = money(state.subtotal);
    sendBtn.disabled = state.isEmpty;
    sendBtn.setAttribute('aria-disabled', String(state.isEmpty));
    fields.hidden = state.isEmpty;
    restoreFocus();
  }

  /** Devuelve el foco al control equivalente tras reconstruir la lista. */
  function restoreFocus() {
    if (!pendingFocus) return;
    const { key, action } = pendingFocus;
    pendingFocus = null;
    if (!node.contains(document.activeElement) && document.activeElement !== document.body) return;
    const target =
      (key && body.querySelector(`[data-focus="${CSS.escape(key)}|${action}"]:not([disabled])`)) ||
      (key && body.querySelector(`[data-focus^="${CSS.escape(key)}|"]:not([disabled])`)) ||
      (isDesktop() ? null : closeBtn) ||
      (sendBtn.disabled ? title : sendBtn);
    target?.focus();
  }

  function copy(text) {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(
        () => true,
        () => false
      );
    }
    return Promise.resolve(false);
  }

  function send() {
    const state = cart.getState();
    if (state.isEmpty) {
      // sin pedido, el botón de WhatsApp abre una conversación normal
      const saludo = buildWhatsappUrl(
        BUSINESS.whatsapp,
        `Hola ${BUSINESS.name}, quiero hacer un pedido.`
      );
      if (saludo) {
        window.open(saludo, '_blank', 'noopener,noreferrer');
        onFlash('Abriendo WhatsApp…');
      } else {
        onFlash('Elige algo de la carta para armar tu pedido.');
      }
      return;
    }
    const text = buildOrderText(state, {
      name: sanitizeText(customer.name, LIMITS.maxNameLength),
      mode: customer.mode
    });
    const url = buildWhatsappUrl(BUSINESS.whatsapp, text);
    if (url && url.length > 1900) {
      // algunos clientes truncan el parámetro text sin avisar
      copy(text).then((ok) =>
        onFlash(
          ok
            ? 'Pedido muy largo para WhatsApp: se copió al portapapeles, pégalo en el chat.'
            : 'El pedido es muy largo. Divídelo en dos, por favor.'
        )
      );
      return;
    }
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
      onFlash('Abriendo WhatsApp con tu pedido…');
      return;
    }
    copy(text).then((ok) =>
      onFlash(ok ? 'Pedido copiado al portapapeles.' : 'No se pudo copiar el pedido.')
    );
  }

  function onKeydown(event) {
    if (isDesktop()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      trapFocus(node, event);
    }
  }

  function open() {
    if (isDesktop()) return;
    lastFocus = document.activeElement;
    node.dataset.open = 'true';
    node.setAttribute('aria-modal', 'true');
    document.addEventListener('keydown', onKeydown, true);
    onToggle?.();
    requestAnimationFrame(() => closeBtn.focus());
  }

  function close() {
    if (isDesktop()) return; // en escritorio la comanda es una columna, no un panel
    if (node.dataset.open !== 'true') return;
    node.dataset.open = 'false';
    node.removeAttribute('aria-modal');
    document.removeEventListener('keydown', onKeydown, true);
    onToggle?.();
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  let booted = false;
  function syncViewport() {
    if (isDesktop()) {
      node.dataset.open = 'true';
      node.removeAttribute('aria-modal');
      } else if (!node.hasAttribute('aria-modal')) {
      node.dataset.open = 'false';
    }
  }

  window.matchMedia(DESKTOP).addEventListener('change', syncViewport);
  syncViewport();

  return {
    render,
    open,
    close,
    send,
    setMode,
    get mode() {
      return customer.mode;
    },
    get isOpen() {
      return node.dataset.open === 'true';
    }
  };
}
