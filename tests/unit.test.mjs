import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCatalog, normalizeSelection, lineKey, describeSelection } from '../src/lib/catalog.js';
import { unitPriceCents, lineTotalCents, cartTotals, clampQty, toPesos } from '../src/lib/pricing.js';
import { createCart, sanitizeText } from '../src/lib/cart.js';
import { buildOrderText, buildWhatsappUrl, isValidPhone } from '../src/lib/order.js';
import { money } from '../src/lib/format.js';
import { STORAGE_KEY, LIMITS } from '../src/config.js';

const MENU = JSON.parse(readFileSync(new URL('../src/data/menu.json', import.meta.url), 'utf8'));
const catalog = createCatalog(MENU);
const alitas = catalog.byId.get('alitas-7');
const suprema = catalog.byId.get('burger-suprema');
const hotdog = catalog.byId.get('hotdog');

class MemoryStorage {
  constructor(seed = {}) {
    this.map = new Map(Object.entries(seed));
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

/* ---------------- catálogo ---------------- */

test('el catálogo resuelve grupos de opciones por producto', () => {
  assert.equal(catalog.products.length, 9);
  assert.equal(catalog.categories.length, 5);
  assert.deepEqual(alitas.groups.map((g) => g.id), ['salsa', 'prep']);
  assert.equal(alitas.groups[0].choices.length, 3);
  assert.equal(hotdog.image, null, 'el hotdog no tiene fotografía todavía');
});

test('todos los precios de la carta coinciden con la carta impresa', () => {
  const expected = {
    'alitas-7': 100,
    'boneless-7': 100,
    'burger-sencilla': 65,
    'burger-especial': 80,
    'burger-suprema': 110,
    carbopapas: 80,
    'papas-fritas': 60,
    hotdog: 30,
    carbodogo: 35
  };
  for (const [id, price] of Object.entries(expected)) {
    assert.equal(catalog.byId.get(id).basePrice, price, id);
  }
});

test('normalizeSelection descarta basura y respeta obligatoriedad', () => {
  assert.deepEqual(normalizeSelection(alitas, null), { salsa: 'mango-habanero' });
  assert.deepEqual(normalizeSelection(alitas, { salsa: 'inexistente' }), { salsa: 'mango-habanero' });
  assert.deepEqual(normalizeSelection(alitas, { salsa: 'bufalo', prep: ['sin-aderezo', 'fake'] }), {
    salsa: 'bufalo',
    prep: ['sin-aderezo']
  });
  assert.deepEqual(normalizeSelection(alitas, { prep: 'no-es-array' }), { salsa: 'mango-habanero' });
  assert.deepEqual(normalizeSelection(hotdog, {}), {});
});

test('lineKey es estable ante el orden de las opciones', () => {
  const a = normalizeSelection(alitas, { salsa: 'bufalo', prep: ['sin-vegetales', 'salsa-aparte'] });
  const b = normalizeSelection(alitas, { prep: ['salsa-aparte', 'sin-vegetales'], salsa: 'bufalo' });
  assert.equal(lineKey('alitas-7', a), lineKey('alitas-7', b));
  assert.notEqual(lineKey('alitas-7', a), lineKey('alitas-7', { salsa: 'barbecue' }));
});

/* ---------------- precios ---------------- */

test('precio unitario y de línea', () => {
  const sel = normalizeSelection(alitas, { salsa: 'bufalo' });
  assert.equal(unitPriceCents(alitas, sel), 10000);
  assert.equal(lineTotalCents(alitas, sel, 3), 30000);
  assert.equal(toPesos(lineTotalCents(alitas, sel, 3)), 300);
});

test('las opciones sin costo no alteran el precio', () => {
  const plain = normalizeSelection(suprema, {});
  const loaded = normalizeSelection(suprema, { prep: ['sin-tocino', 'sin-pina', 'sin-vegetales'] });
  assert.equal(unitPriceCents(suprema, plain), unitPriceCents(suprema, loaded));
});

test('los ajustes de precio se suman en centavos, sin errores de coma flotante', () => {
  const fake = {
    basePrice: 0.1,
    groups: [
      { id: 'x', type: 'multi', choices: [{ id: 'a', priceDelta: 0.2 }, { id: 'b', priceDelta: 12.35 }] }
    ]
  };
  assert.equal(unitPriceCents(fake, { x: ['a'] }), 30);
  assert.equal(toPesos(unitPriceCents(fake, { x: ['a', 'b'] })), 12.65);
  assert.equal(money(12.65), '$12.65');
  assert.equal(money(100), '$100');
});

test('clampQty acota cantidades absurdas', () => {
  assert.equal(clampQty(0), 1);
  assert.equal(clampQty(-7), 1);
  assert.equal(clampQty(999), LIMITS.maxQty);
  assert.equal(clampQty('4'), 4);
  assert.equal(clampQty(NaN), 1);
  assert.equal(clampQty(3.9), 3);
});

test('cartTotals suma varias líneas', () => {
  const totals = cartTotals([
    { product: alitas, selection: { salsa: 'bufalo' }, qty: 2 },
    { product: suprema, selection: {}, qty: 1 },
    { product: hotdog, selection: {}, qty: 3 }
  ]);
  assert.equal(totals.count, 6);
  assert.equal(totals.subtotal, 100 * 2 + 110 + 30 * 3);
  assert.equal(totals.lines[0].total, 200);
});

/* ---------------- carrito ---------------- */

test('agregar, fusionar, editar y eliminar', () => {
  const cart = createCart(catalog, new MemoryStorage());
  const key = cart.add(alitas, { salsa: 'bufalo' }, 1, '');
  cart.add(alitas, { salsa: 'bufalo' }, 2, '');
  assert.equal(cart.getState().lines.length, 1, 'misma configuración = una sola línea');
  assert.equal(cart.getState().count, 3);

  cart.add(alitas, { salsa: 'barbecue' }, 1, '');
  assert.equal(cart.getState().lines.length, 2, 'distinta salsa = línea distinta');

  cart.setQty(key, 5);
  assert.equal(cart.getState().lines.find((l) => l.key === key).qty, 5);
  cart.setQty(key, 0);
  assert.equal(cart.getState().lines.length, 1, 'cantidad 0 elimina la línea');

  cart.clear();
  assert.ok(cart.getState().isEmpty);
});

test('una nota distinta crea una línea distinta', () => {
  const cart = createCart(catalog, new MemoryStorage());
  cart.add(suprema, {}, 1, 'sin sal');
  cart.add(suprema, {}, 1, '');
  assert.equal(cart.getState().lines.length, 2);
});

test('replace fusiona con una línea equivalente', () => {
  const cart = createCart(catalog, new MemoryStorage());
  const a = cart.add(alitas, { salsa: 'bufalo' }, 1, '');
  cart.add(alitas, { salsa: 'barbecue' }, 2, '');
  cart.replace(a, alitas, { salsa: 'barbecue' }, 1, '');
  const state = cart.getState();
  assert.equal(state.lines.length, 1);
  assert.equal(state.count, 3);
});

test('el tope de líneas del pedido se respeta', () => {
  const cart = createCart(catalog, new MemoryStorage());
  for (let i = 0; i < LIMITS.maxCartLines + 5; i++) {
    cart.add(alitas, { salsa: 'bufalo' }, 1, `nota ${i}`);
  }
  assert.equal(cart.getState().lines.length, LIMITS.maxCartLines);
});

test('persiste y rehidrata recalculando precios desde el catálogo', () => {
  const storage = new MemoryStorage();
  const first = createCart(catalog, storage);
  first.add(alitas, { salsa: 'barbecue', prep: ['sin-aderezo'] }, 2, 'poco picante');
  const saved = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(saved.v, 1);
  assert.ok(!JSON.stringify(saved).includes('100'), 'no se guardan precios');

  const second = createCart(catalog, storage);
  const state = second.getState();
  assert.equal(state.lines.length, 1);
  assert.equal(state.subtotal, 200);
  assert.equal(state.lines[0].note, 'poco picante');
  assert.deepEqual(state.lines[0].selection, { salsa: 'barbecue', prep: ['sin-aderezo'] });
});

test('localStorage corrupto no rompe la aplicación', () => {
  for (const payload of ['{{{', 'null', '[]', '{"v":99,"items":[]}', '{"v":1,"items":"x"}',
    '{"v":1,"items":[{"p":"producto-fantasma","q":2}]}',
    '{"v":1,"items":[{"p":"alitas-7","s":{"salsa":"veneno"},"q":-4}]}']) {
    const storage = new MemoryStorage({ [STORAGE_KEY]: payload });
    const cart = createCart(catalog, storage);
    const state = cart.getState();
    assert.ok(Array.isArray(state.lines));
    if (payload.includes('alitas-7')) {
      assert.equal(state.lines.length, 1);
      assert.equal(state.lines[0].qty, 1, 'la cantidad inválida se acota');
      assert.equal(state.lines[0].selection.salsa, 'mango-habanero');
    }
  }
});

test('el carrito sobrevive sin almacenamiento', () => {
  const broken = {
    getItem() { throw new Error('bloqueado'); },
    setItem() { throw new Error('bloqueado'); },
    removeItem() { throw new Error('bloqueado'); }
  };
  const cart = createCart(catalog, broken);
  assert.equal(cart.hasStorage, false);
  cart.add(suprema, {}, 1, '');
  assert.equal(cart.getState().count, 1);
});

/* ---------------- texto libre ---------------- */

test('sanitizeText limpia control, colapsa espacios y recorta', () => {
  assert.equal(sanitizeText('  hola \n\t mundo  ', 100), 'hola mundo');
  assert.equal(sanitizeText('a b​c', 100), 'a b c');
  assert.equal(sanitizeText('x'.repeat(500), LIMITS.maxNoteLength).length, LIMITS.maxNoteLength);
  assert.equal(sanitizeText(null, 10), '');
  assert.equal(sanitizeText({ toString: () => 'obj' }, 10), '');
});

/* ---------------- pedido ---------------- */

test('la comanda en texto refleja producto, opciones, nota y total', () => {
  const cart = createCart(catalog, new MemoryStorage());
  cart.add(alitas, { salsa: 'bufalo', prep: ['salsa-aparte'] }, 2, 'bien doraditas');
  cart.add(hotdog, { prep: ['sin-cebolla'] }, 1, '');
  const text = buildOrderText(cart.getState(), { name: 'Nataly', mode: 'llevar' });
  assert.match(text, /\*CARBOLITAS\* · Pedido/);
  assert.match(text, /1\. Alitas al carbón \(7 piezas\) x2 — \$200/);
  assert.match(text, /Elige tu salsa: Búfalo/);
  assert.match(text, /Nota: bien doraditas/);
  assert.match(text, /2\. Hotdog con tocino x1 — \$30/);
  assert.match(text, /TOTAL: \$230 MXN/);
  assert.match(text, /Servicio: Para llevar/);
  assert.match(text, /Nombre: Nataly/);
});

test('el nombre del cliente no puede inyectar saltos ni control en la comanda', () => {
  const cart = createCart(catalog, new MemoryStorage());
  cart.add(hotdog, {}, 1, '');
  const text = buildOrderText(cart.getState(), { name: 'Ana\nTOTAL: $0\r\nfalso', mode: 'local' });
  const totalLines = text.split('\n').filter((line) => line.startsWith('TOTAL:'));
  assert.equal(totalLines.length, 1, 'no se puede inyectar una línea de total falsa');
  assert.equal(totalLines[0], 'TOTAL: $30 MXN');
  assert.match(text, /Nombre: Ana TOTAL: \$0 falso/);
});

test('validación del teléfono del negocio', () => {
  assert.ok(isValidPhone('525512345678'));
  assert.ok(isValidPhone('+52 55 1234 5678'));
  assert.ok(!isValidPhone(''));
  assert.ok(!isValidPhone('123'));
  assert.ok(!isValidPhone('javascript:alert(1)'));
});

test('la URL de WhatsApp se construye codificada o no se construye', () => {
  assert.equal(buildWhatsappUrl('', 'hola'), null);
  assert.equal(buildWhatsappUrl('abc', 'hola'), null);
  const url = buildWhatsappUrl('+52 (55) 1234-5678', 'a b&c=d\nsalto');
  assert.equal(url, 'https://wa.me/525512345678?text=a%20b%26c%3Dd%0Asalto');
  assert.ok(new URL(url).protocol === 'https:');
});

test('describeSelection devuelve etiquetas legibles en orden de catálogo', () => {
  const sel = normalizeSelection(alitas, { prep: ['sin-aderezo', 'salsa-aparte'], salsa: 'barbecue' });
  assert.deepEqual(describeSelection(alitas, sel), [
    { groupId: 'salsa', groupLabel: 'Elige tu salsa', labels: ['Barbecue'] },
    { groupId: 'prep', groupLabel: 'Preparación', labels: ['Salsa aparte', 'Sin aderezo'] }
  ]);
});

/* ---------------- horario ---------------- */

test('el estado de apertura se calcula en la hora del local', async () => {
  const { openStatus } = await import('../src/lib/schedule.js');
  const { prettyTime } = await import('../src/lib/document.js');
  const caso = (iso) => openStatus(new Date(iso));

  // miércoles 7:00 p.m. (hora de México) → abierto
  assert.deepEqual(caso('2026-09-16T19:00:00-06:00'), {
    open: true,
    label: 'Abierto · cierra 10:00 p.m.'
  });
  // miércoles 6:29 p.m. → todavía no abre
  assert.deepEqual(caso('2026-09-16T18:29:00-06:00'), {
    open: false,
    label: 'Cerrado · abre hoy 6:30 p.m.'
  });
  // miércoles 10:00 p.m. en punto → ya cerró
  assert.equal(caso('2026-09-16T22:00:00-06:00').open, false);
  // martes: día de descanso, abre el miércoles
  assert.deepEqual(caso('2026-09-15T20:00:00-06:00'), {
    open: false,
    label: 'Cerrado · abre mañana 6:30 p.m.'
  });
  // lunes por la noche → abierto (miércoles a lunes)
  assert.equal(caso('2026-09-14T20:00:00-06:00').open, true);
  // domingo por la noche → abierto
  assert.equal(caso('2026-09-13T21:30:00-06:00').open, true);

  assert.equal(prettyTime(18 * 60 + 30), '6:30 p.m.');
  assert.equal(prettyTime(22 * 60), '10:00 p.m.');
  assert.equal(prettyTime(0), '12:00 a.m.');
});

test('un cliente en otra zona horaria ve el horario del local', async () => {
  const { openStatus } = await import('../src/lib/schedule.js');
  // 03:00 UTC del jueves = 21:00 del miércoles en Maravatío → abierto
  assert.equal(openStatus(new Date('2026-09-17T03:00:00Z')).open, true);
});

test('sin horario configurado no se afirma nada', async () => {
  const { openStatus } = await import('../src/lib/schedule.js');
  assert.deepEqual(openStatus(new Date(), null), { open: false, label: '' });
  assert.deepEqual(openStatus(new Date(), { days: [], from: 0, to: 0 }), {
    open: false,
    label: ''
  });
});
