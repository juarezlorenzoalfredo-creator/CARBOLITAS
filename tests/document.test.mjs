/**
 * El validador del documento es la única puerta por la que entra lo que el
 * panel envía. Estas pruebas cubren lo que pasa cuando lo que llega está mal:
 * a mano, por error o a propósito.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeDays,
  describeSchedule,
  normalizeDoc,
  prettyTime,
  slugify
} from '../src/lib/document.js';

const base = () => ({
  currency: 'MXN',
  business: {
    whatsapp: '524471257475',
    phone: '4471257475',
    address: 'Calle 1',
    mapsUrl: 'https://maps.app.goo.gl/x',
    schedule: { days: [0, 1, 3, 4, 5, 6], from: 1110, to: 1320 }
  },
  categories: [{ id: 'dogos', name: 'Dogos', kicker: '', note: '' }],
  optionGroups: {
    salsa: {
      id: 'salsa',
      label: 'Elige tu salsa',
      type: 'single',
      required: true,
      choices: [{ id: 'bbq', label: 'Barbecue', priceDelta: 0, heat: 1 }]
    }
  },
  products: [
    {
      id: 'hotdog',
      categoryId: 'dogos',
      name: 'Hotdog con tocino',
      basePrice: 30,
      optionGroups: ['salsa'],
      available: true
    }
  ]
});

test('la semana se lee como la diría una persona', () => {
  assert.equal(describeDays([0, 1, 3, 4, 5, 6]), 'Miércoles a lunes');
  assert.equal(describeDays([0, 1, 2, 3, 4, 5, 6]), 'Todos los días');
  assert.equal(describeDays([1, 2, 3, 4, 5]), 'Lunes a viernes');
  assert.equal(describeDays([6, 0]), 'Sábado y domingo');
  assert.equal(describeDays([2]), 'Martes');
  assert.equal(describeDays([]), '');
});

test('el horario escrito sale del horario real, no se teclea aparte', () => {
  const lineas = describeSchedule({ days: [0, 1, 3, 4, 5, 6], from: 1110, to: 1320 });
  assert.deepEqual(lineas, [
    { days: 'Miércoles a lunes', hours: '6:30 p.m. – 10:00 p.m.' },
    { days: 'Martes', hours: 'Cerrado' }
  ]);
  assert.equal(prettyTime(0), '12:00 a.m.');
  assert.equal(prettyTime(12 * 60), '12:00 p.m.');
});

test('el identificador sale del nombre y aguanta acentos', () => {
  assert.equal(slugify('Hotdog con tocino'), 'hotdog-con-tocino');
  assert.equal(slugify('  Alitas al CARBÓN  '), 'alitas-al-carbon');
  assert.equal(slugify('¡¡¡'), '');
});

test('una carta correcta pasa sin cambios ni avisos', () => {
  const { doc, errors } = normalizeDoc(base(), { images: [] });
  assert.deepEqual(errors, []);
  assert.equal(doc.products.length, 1);
  assert.equal(doc.products[0].basePrice, 30);
  assert.equal(doc.business.whatsapp, '524471257475');
});

test('un precio que no es un número descarta el platillo', () => {
  const raw = base();
  raw.products.push({ id: 'b', categoryId: 'dogos', name: 'Texto', basePrice: 'gratis' });
  raw.products.push({ id: 'd', categoryId: 'dogos', name: 'Infinito', basePrice: Infinity });
  const { doc, errors } = normalizeDoc(raw, { images: [] });
  assert.deepEqual(doc.products.map((p) => p.name), ['Hotdog con tocino']);
  assert.equal(errors.length, 2);
});

test('un precio fuera de rango se ajusta, no borra el platillo', () => {
  /* Teclear 300000 en lugar de 300.00 no debe hacer desaparecer el platillo
     de la carta: se acota al máximo y se avisa. */
  const raw = base();
  raw.products.push({ id: 'a', categoryId: 'dogos', name: 'Negativo', basePrice: -10 });
  raw.products.push({ id: 'z', categoryId: 'dogos', name: 'Enorme', basePrice: 300000 });
  raw.products.push({ id: 'c', categoryId: 'dogos', name: 'Coma', basePrice: '99,50' });
  const { doc, errors } = normalizeDoc(raw, { images: [] });
  assert.deepEqual(doc.products.map((p) => p.name), [
    'Hotdog con tocino',
    'Negativo',
    'Enorme',
    'Coma'
  ]);
  assert.equal(doc.products[1].basePrice, 0);
  assert.equal(doc.products[2].basePrice, 99999);
  assert.equal(doc.products[3].basePrice, 99.5);
  assert.equal(errors.filter((e) => /se ajustó/.test(e)).length, 2);
});

test('los decimales se redondean a centavos', () => {
  const raw = base();
  raw.products[0].basePrice = 30.006;
  assert.equal(normalizeDoc(raw, { images: [] }).doc.products[0].basePrice, 30.01);
});

test('un producto huérfano se reubica en lugar de perderse', () => {
  const raw = base();
  raw.products[0].categoryId = 'no-existe';
  const { doc, errors } = normalizeDoc(raw, { images: [] });
  assert.equal(doc.products[0].categoryId, 'dogos');
  assert.match(errors.join(' '), /categoría que no existe/);
});

test('las fotos inventadas no llegan a la carta', () => {
  const raw = base();
  raw.products[0].image = '../../etc/passwd';
  const { doc, errors } = normalizeDoc(raw, { images: ['boneless'] });
  assert.equal(doc.products[0].image, null);
  assert.match(errors.join(' '), /no existe/);
});

test('sólo se admiten rutas de imagen del propio sitio', () => {
  const raw = base();
  raw.images = {
    buena: { ratio: 1.333, variants: [{ w: 320, h: 240, src: 'api/foto/buena-320.webp' }] },
    mala: { ratio: 1.333, variants: [{ w: 320, h: 240, src: 'https://otro.sitio/x.webp' }] },
    'java script': { ratio: 1, variants: [{ w: 320, h: 240, src: 'img/x.webp' }] }
  };
  const { doc } = normalizeDoc(raw, { images: [] });
  assert.deepEqual(Object.keys(doc.images), ['buena']);
});

test('una foto admitida queda disponible para los platillos', () => {
  const raw = base();
  raw.images = {
    nueva: { ratio: 1.333, variants: [{ w: 320, h: 240, src: 'api/foto/nueva-320.webp' }] }
  };
  raw.products[0].image = 'nueva';
  const { doc, errors } = normalizeDoc(raw, { images: [] });
  assert.equal(doc.products[0].image, 'nueva');
  assert.deepEqual(errors, []);
});

test('el enlace del mapa tiene que ser https', () => {
  const raw = base();
  raw.business.mapsUrl = 'javascript:alert(1)';
  const { doc, errors } = normalizeDoc(raw, { images: [] });
  assert.equal(doc.business.mapsUrl, '');
  assert.match(errors.join(' '), /https/);
});

test('un WhatsApp que no es un número queda vacío, no roto', () => {
  const raw = base();
  raw.business.whatsapp = '55-AB';
  const { doc, errors } = normalizeDoc(raw, { images: [] });
  assert.equal(doc.business.whatsapp, '');
  assert.match(errors.join(' '), /dígitos/);
});

test('cerrar después de medianoche es un horario válido', () => {
  const raw = base();
  raw.business.schedule = { days: [5, 6], from: 18 * 60 + 30, to: 60 };
  const { doc, errors } = normalizeDoc(raw, { images: [] });
  assert.deepEqual(doc.business.schedule, { days: [5, 6], from: 1110, to: 1500 });
  assert.deepEqual(errors, []);
  assert.deepEqual(describeSchedule(doc.business.schedule)[0], {
    days: 'Viernes y sábado',
    hours: '6:30 p.m. – 1:00 a.m.'
  });
});

test('una jornada de más de 24 horas no es un horario', () => {
  const raw = base();
  raw.business.schedule = { days: [1], from: 60, to: 2000 };
  const { doc, errors } = normalizeDoc(raw, { images: [] });
  assert.equal(doc.business.schedule, null);
  assert.match(errors.join(' '), /Horario inválido/);
});

test('el identificador de un grupo de opciones es siempre su clave', () => {
  /* Dos grupos con el mismo id se pisaban la respuesta del cliente en la
     ficha, y la comanda llegaba a la cocina incompleta. */
  const raw = base();
  raw.optionGroups['prep-dogo'] = {
    id: 'prep',
    label: 'Preparación',
    type: 'multi',
    choices: [{ id: 'sin-cebolla', label: 'Sin cebolla' }]
  };
  raw.optionGroups['prep-papas'] = {
    id: 'prep',
    label: 'Preparación',
    type: 'multi',
    choices: [{ id: 'sin-sal', label: 'Sin sal' }]
  };
  const { doc } = normalizeDoc(raw, { images: [] });
  assert.equal(doc.optionGroups['prep-dogo'].id, 'prep-dogo');
  assert.equal(doc.optionGroups['prep-papas'].id, 'prep-papas');
});

test('los identificadores repetidos se separan en vez de pisarse', () => {
  const raw = base();
  raw.products.push({ id: 'hotdog', categoryId: 'dogos', name: 'Otro', basePrice: 20 });
  const { doc } = normalizeDoc(raw, { images: [] });
  assert.deepEqual(
    doc.products.map((p) => p.id),
    ['hotdog', 'hotdog-2']
  );
});

test('el texto se limpia de caracteres invisibles y se acota', () => {
  const nulo = String.fromCharCode(0);
  const anchoCero = String.fromCharCode(0x200b);
  const raw = base();
  raw.products[0].name = ` Hot${nulo}dog${anchoCero}  con   tocino `;
  raw.products[0].description = 'x'.repeat(500);
  const { doc } = normalizeDoc(raw, { images: [] });
  assert.equal(doc.products[0].name, 'Hotdog con tocino');
  assert.equal(doc.products[0].description.length, 320);
});

test('el nombre se guarda como texto, sin interpretar', () => {
  const raw = base();
  raw.products[0].name = '<script>alert(1)</script>';
  const { doc } = normalizeDoc(raw, { images: [] });
  /* Se conserva tal cual: la carta lo pinta con textContent y el build lo
     escapa. Reescribirlo aquí escondería el problema en lugar de resolverlo. */
  assert.equal(doc.products[0].name, '<script>alert(1)</script>');
});

test('un grupo de opciones sin opciones no se guarda', () => {
  const raw = base();
  raw.optionGroups.vacio = { id: 'vacio', label: 'Vacío', type: 'single', choices: [] };
  const { doc, errors } = normalizeDoc(raw, { images: [] });
  assert.equal(doc.optionGroups.vacio, undefined);
  assert.match(errors.join(' '), /sin opciones/);
});

test('un producto no puede apuntar a un grupo de opciones inexistente', () => {
  const raw = base();
  raw.products[0].optionGroups = ['salsa', 'fantasma'];
  const { doc } = normalizeDoc(raw, { images: [] });
  assert.deepEqual(doc.products[0].optionGroups, ['salsa']);
});

test('basura total devuelve una carta vacía pero con forma válida', () => {
  for (const entrada of [null, 'texto', 42, [], { products: 'no' }]) {
    const { doc } = normalizeDoc(entrada, { images: [] });
    assert.equal(doc.schema, 1);
    assert.deepEqual(doc.products, []);
    assert.deepEqual(doc.categories, []);
    assert.equal(typeof doc.business, 'object');
  }
});

test('el número de productos tiene tope', () => {
  const raw = base();
  raw.products = Array.from({ length: 200 }, (_, i) => ({
    id: `p${i}`,
    categoryId: 'dogos',
    name: `P${i}`,
    basePrice: 10
  }));
  const { doc, errors } = normalizeDoc(raw, { images: [] });
  assert.equal(doc.products.length, 80);
  assert.match(errors.join(' '), /Sólo caben/);
});

test('agotar un platillo es un estado, no un borrado', () => {
  const raw = base();
  raw.products[0].available = false;
  const { doc } = normalizeDoc(raw, { images: [] });
  assert.equal(doc.products.length, 1);
  assert.equal(doc.products[0].available, false);
});

test('normalizar dos veces da el mismo resultado', () => {
  const uno = normalizeDoc(base(), { images: [] }).doc;
  const dos = normalizeDoc(uno, { images: [] }).doc;
  assert.deepEqual(dos, uno);
});
