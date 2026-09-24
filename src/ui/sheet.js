/** Ficha de producto: hoja inferior con opciones reales, cantidad y precio vivo. */
import { LIMITS } from '../config.js';
import { money } from '../lib/format.js';
import { missingRequired, normalizeSelection } from '../lib/catalog.js';
import { clampQty, unitPriceCents, toPesos } from '../lib/pricing.js';
import { $, clear, h, trapFocus } from './dom.js';
import { grillTile, heatDots, pictureFor } from './media.js';

export function createSheet({ node, images, onSubmit, onClose }) {
  let product = null;
  let selection = {};
  let qty = 1;
  let note = '';
  let editKey = null;
  let lastFocus = null;

  const scroll = h('div.sheet__scroll');
  const foot = h('div.sheet__foot');
  node.append(scroll, foot);
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-modal', 'true');
  node.setAttribute('aria-labelledby', 'sheet-title');
  node.dataset.open = 'false';

  const priceOut = h('b', { text: '' });
  const addLabel = h('span', { text: 'Agregar' });
  const qtyOut = h('output', { 'aria-live': 'polite', text: '1' });
  const addBtn = h(
    'button.btn-add',
    { type: 'button', on: { click: submit } },
    [addLabel, priceOut]
  );
  const minus = h('button', {
    type: 'button',
    'aria-label': 'Quitar una unidad',
    text: '−',
    on: { click: () => setQty(qty - 1) }
  });
  const plus = h('button', {
    type: 'button',
    'aria-label': 'Agregar una unidad',
    text: '+',
    on: { click: () => setQty(qty + 1) }
  });
  foot.append(h('div.stepper.stepper--dark', {}, [minus, qtyOut, plus]), addBtn);

  function setQty(next) {
    qty = clampQty(next);
    qtyOut.textContent = String(qty);
    const active = document.activeElement;
    minus.disabled = qty <= LIMITS.minQty;
    plus.disabled = qty >= LIMITS.maxQty;
    // un botón deshabilitado pierde el foco: se lo pasamos a su pareja
    if (active === minus && minus.disabled) plus.focus();
    else if (active === plus && plus.disabled) minus.focus();
    refreshPrice();
  }

  function refreshPrice() {
    // misma entrada que usará el carrito: nunca se muestra un precio que no se cobre
    const total = toPesos(unitPriceCents(product, normalizeSelection(product, selection)) * qty);
    const pending = missingRequired(product, selection);
    addBtn.disabled = Boolean(pending);
    addLabel.textContent = pending
      ? pending.label
      : editKey
        ? 'Guardar'
        : 'Agregar';
    priceOut.textContent = pending ? '' : money(total);
    addBtn.setAttribute(
      'aria-label',
      pending
        ? `${pending.label} para continuar`
        : `${editKey ? 'Guardar' : 'Agregar'} ${qty} × ${product.name} al pedido, ${money(total)}`
    );
  }

  function optionGroup(group) {
    const inputName = `opt-${group.id}`;
    const isSingle = group.type === 'single';
    const tags = group.choices.map((choice) => {
      const value = selection[group.id];
      const on = isSingle
        ? value === choice.id
        : Array.isArray(value) && value.includes(choice.id);
      const input = h('input.sr-only', {
        type: isSingle ? 'radio' : 'checkbox',
        name: inputName,
        value: choice.id,
        checked: on || null
      });
      const label = h('label.tag', { dataset: { on: String(on) } }, [
        input,
        h('span', { text: choice.label }),
        choice.heat ? heatDots(choice.heat) : null
      ]);
      input.addEventListener('change', () => {
        if (isSingle) {
          selection[group.id] = choice.id;
          label.parentElement
            .querySelectorAll('.tag')
            .forEach((t) => (t.dataset.on = String(t === label)));
        } else {
          const current = Array.isArray(selection[group.id]) ? selection[group.id].slice() : [];
          const idx = current.indexOf(choice.id);
          if (input.checked && idx === -1) current.push(choice.id);
          if (!input.checked && idx !== -1) current.splice(idx, 1);
          selection[group.id] = current;
          label.dataset.on = String(input.checked);
        }
        refreshPrice();
      });
      return label;
    });

    return h('div.group', {}, [
      h('div.group__head', {}, [
        h('span.group__label', { text: group.label }),
        group.hint ? h('span.group__hint', { text: group.hint }) : null
      ]),
      h('div.tags', { role: isSingle ? 'radiogroup' : 'group', 'aria-label': group.label }, tags)
    ]);
  }

  function build() {
    clear(scroll);
    const plate = h('div.plato', {}, [
      product.image
        ? pictureFor(images, product.image, {
            sizes: '13rem',
            alt: product.imageAlt,
            priority: true
          })
        : grillTile(product.name)
    ]);
    const closeBtn = h('button.sheet__close', {
      type: 'button',
      'aria-label': 'Cerrar',
      text: '✕',
      on: { click: close }
    });
    const noteField = h('textarea', {
      id: 'sheet-note',
      maxlength: LIMITS.maxNoteLength,
      rows: 2,
      placeholder: 'Ej. término bien cocido, sin sal…',
      value: note,
      on: {
        input: (e) => {
          note = e.target.value;
        }
      }
    });

    scroll.append(
      h('div.sheet__media', {}, [plate, closeBtn]),
      h('div.sheet__body', {}, [
        h('p.kicker', { text: [product.kicker, product.unit].filter(Boolean).join(' · ') }),
        h('h2.sheet__title', { id: 'sheet-title', text: product.name }),
        h('p.sheet__desc', { text: product.description }),
        ...product.groups.map(optionGroup),
        h('div.group.sheet__note', {}, [
          h('div.group__head', {}, [
            h('label.group__label', { for: 'sheet-note', text: 'Nota para la cocina' }),
            h('span.group__hint', { text: 'Opcional' })
          ]),
          noteField
        ])
      ])
    );
  }

  function submit() {
    if (missingRequired(product, selection)) return;
    onSubmit({ product, selection, qty, note, editKey });
    close();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      trapFocus(node, event);
    }
  }

  function open(nextProduct, options = {}) {
    product = nextProduct;
    // al abrir un producto nuevo no se preselecciona nada obligatorio:
    // que la salsa la elija el cliente, no el valor por defecto
    selection = normalizeSelection(product, options.selection, {
      fillRequired: Boolean(options.editKey)
    });
    note = options.note || '';
    editKey = options.editKey || null;
    lastFocus = document.activeElement;
    build();
    setQty(options.qty || 1);
    node.dataset.open = 'true';
    document.addEventListener('keydown', onKeydown, true);
    scroll.scrollTop = 0;
    requestAnimationFrame(() => $('.sheet__close', node)?.focus());
  }

  function close() {
    if (node.dataset.open !== 'true') return;
    node.dataset.open = 'false';
    document.removeEventListener('keydown', onKeydown, true);
    onClose?.();
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  return { open, close, get isOpen() {
    return node.dataset.open === 'true';
  } };
}
