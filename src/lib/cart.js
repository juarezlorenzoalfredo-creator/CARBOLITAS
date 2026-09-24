/**
 * Estado del pedido. Guarda referencias (producto + selección + cantidad),
 * nunca precios: el importe se recalcula siempre desde el catálogo vigente.
 */
import { LIMITS, STORAGE_KEY } from '../config.js';
import { lineKey, missingRequired, normalizeSelection } from './catalog.js';
import { cartTotals, clampQty } from './pricing.js';

const SCHEMA_VERSION = 1;

/** Controles C0/C1, DEL y espacios de ancho cero. */
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F\\u200B-\\u200D\\uFEFF]', 'g');

/** Texto libre del cliente: sin caracteres de control, longitud acotada. */
export function sanitizeText(value, max) {
  if (typeof value !== 'string') return '';
  return value
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function createCart(catalogInicial, storage) {
  let catalog = catalogInicial;
  /** @type {{key:string,productId:string,selection:any,qty:number,note:string}[]} */
  let items = [];
  /** @type {Set<Function>} */
  const listeners = new Set();

  const store = (() => {
    try {
      const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      if (!s) return null;
      const probe = '__cb__';
      s.setItem(probe, '1');
      s.removeItem(probe);
      return s;
    } catch {
      return null; // modo privado, cookies bloqueadas, cuota llena
    }
  })();

  function persist() {
    if (!store) return;
    try {
      store.setItem(
        STORAGE_KEY,
        JSON.stringify({
          v: SCHEMA_VERSION,
          items: items.map((i) => ({ p: i.productId, s: i.selection, q: i.qty, n: i.note }))
        })
      );
    } catch {
      /* almacenamiento lleno: el pedido sigue vivo en memoria */
    }
  }

  function hydrate() {
    if (!store) return;
    let parsed;
    try {
      parsed = JSON.parse(store.getItem(STORAGE_KEY) || 'null');
    } catch {
      store.removeItem(STORAGE_KEY);
      return;
    }
    if (!parsed || parsed.v !== SCHEMA_VERSION || !Array.isArray(parsed.items)) {
      if (parsed) store.removeItem(STORAGE_KEY);
      return;
    }
    for (const entry of parsed.items.slice(0, LIMITS.maxCartLines)) {
      const product = catalog.byId.get(entry && entry.p);
      if (!product || product.available === false) continue;
      add(product, entry.s, entry.q, entry.n, { silent: true });
    }
  }

  function emit() {
    const snapshot = getState();
    listeners.forEach((fn) => fn(snapshot));
  }

  function add(product, rawSelection, qty, note, opts = {}) {
    const selection = normalizeSelection(product, rawSelection);
    const key = lineKey(product.id, selection);
    const cleanNote = sanitizeText(note, LIMITS.maxNoteLength);
    const existing = items.find((i) => i.key === key && i.note === cleanNote);
    if (existing) {
      existing.qty = clampQty(existing.qty + clampQty(qty));
    } else {
      if (items.length >= LIMITS.maxCartLines) return null;
      items.push({ key, productId: product.id, selection, qty: clampQty(qty), note: cleanNote });
    }
    if (!opts.silent) {
      persist();
      emit();
    }
    return key;
  }

  function replace(key, product, rawSelection, qty, note) {
    const index = items.findIndex((i) => i.key === key);
    if (index === -1) return null;
    const selection = normalizeSelection(product, rawSelection);
    const nextKey = lineKey(product.id, selection);
    const cleanNote = sanitizeText(note, LIMITS.maxNoteLength);
    const merge = items.findIndex(
      (i, idx) => idx !== index && i.key === nextKey && i.note === cleanNote
    );
    if (merge !== -1) {
      items[merge].qty = clampQty(items[merge].qty + clampQty(qty));
      items.splice(index, 1);
    } else {
      items[index] = {
        key: nextKey,
        productId: product.id,
        selection,
        qty: clampQty(qty),
        note: cleanNote
      };
    }
    persist();
    emit();
    return nextKey;
  }

  function setQty(key, qty) {
    const item = items.find((i) => i.key === key);
    if (!item) return;
    const next = Math.floor(Number(qty));
    if (next <= 0) return remove(key);
    item.qty = clampQty(next);
    persist();
    emit();
  }

  function remove(key) {
    const before = items.length;
    items = items.filter((i) => i.key !== key);
    if (items.length !== before) {
      persist();
      emit();
    }
  }

  function clear() {
    if (!items.length) return;
    items = [];
    persist();
    emit();
  }

  function getState() {
    const lines = items
      .map((i) => ({ ...i, product: catalog.byId.get(i.productId) }))
      .filter((i) => i.product);
    const totals = cartTotals(lines);
    return {
      lines: lines.map((line, index) => ({ ...line, ...totals.lines[index] })),
      count: totals.count,
      subtotal: totals.subtotal,
      subtotalCents: totals.subtotalCents,
      isEmpty: lines.length === 0
    };
  }

  /**
   * Cambia el catálogo vigente (la carta se republicó desde el panel) y
   * revalida el pedido: se cae lo que ya no existe o se agotó, se renormaliza
   * la selección por si una salsa desapareció y se funden las líneas que
   * quedan iguales. Los precios no se tocan porque nunca se guardaron.
   * @returns {boolean} true si el pedido del cliente cambió
   */
  function setCatalog(next) {
    catalog = next;
    const huella = () =>
      items
        .map((i) => {
          const p = catalog.byId.get(i.productId);
          return `${i.key}#${i.note}#${i.qty}#${p ? p.basePrice : 'x'}`;
        })
        .join('|');
    const antes = huella();
    const rebuilt = [];
    for (const item of items) {
      const product = catalog.byId.get(item.productId);
      if (!product || product.available === false) continue;
      /* fillRequired en false: si la carta añadió una pregunta obligatoria,
         no se le contesta por el cliente —podría costarle dinero—; la línea
         se cae y el cliente la vuelve a armar eligiendo él. */
      const selection = normalizeSelection(product, item.selection, { fillRequired: false });
      if (missingRequired(product, selection)) continue;
      const key = lineKey(product.id, selection);
      const twin = rebuilt.find((i) => i.key === key && i.note === item.note);
      /* Sólo se funden si caben: fundir 12 + 12 en un máximo de 20 le borraba
         cuatro órdenes al cliente sin decírselo. */
      if (twin && twin.qty + item.qty <= LIMITS.maxQty) twin.qty += item.qty;
      else rebuilt.push({ ...item, key, selection });
    }
    items = rebuilt;
    const cambio = antes !== huella();
    if (cambio) persist();
    emit();
    return cambio;
  }

  hydrate();

  return {
    add,
    setCatalog,
    replace,
    setQty,
    remove,
    clear,
    getState,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get hasStorage() {
      return Boolean(store);
    }
  };
}
