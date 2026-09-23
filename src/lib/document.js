/**
 * Documento de la carta: la única estructura que el panel edita, el servidor
 * guarda y la carta pública lee.
 *
 * Nada de lo que llega de fuera se cree: `normalizeDoc` reconstruye el
 * documento campo por campo a partir de una plantilla conocida. Lo que no
 * encaja se descarta y queda anotado en `errors`. Así el mismo código protege
 * al servidor (entrada del panel) y al cliente (respuesta del servidor).
 */

/* Caracteres de control e invisibles: nunca deben llegar al texto guardado. */
const INVISIBLES = new RegExp('[\\u0000-\\u001F\\u007F\\u200B-\\u200D\\uFEFF]', 'g');
const ID_RE = new RegExp('^[a-z0-9][a-z0-9-]{0,39}$');

export const LIMITES = {
  categorias: 14,
  productos: 80,
  grupos: 14,
  opciones: 14,
  variantes: 6,
  fotos: 40,
  nombre: 60,
  descripcion: 320,
  nota: 240,
  precioMax: 99999
};

const DIAS = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado'
];

/** Texto plano, recortado y acotado. Nunca null: siempre una cadena. */
export function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(INVISIBLES, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Identificador estable a partir de un nombre: "Hotdog con tocino" → "hotdog-con-tocino". */
export function slugify(value) {
  return cleanText(value, 80)
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function isId(value) {
  return typeof value === 'string' && ID_RE.test(value);
}

/**
 * Precio en pesos. Si el número existe pero se sale de rango se ajusta al
 * límite; sólo se rechaza lo que no es un número. Un dedo que teclea 300000 en
 * lugar de 300.00 no debe borrar el platillo de la carta.
 * @returns {{valor:number, ajustado:boolean}|null}
 */
function cleanPrice(value) {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const acotado = Math.min(Math.max(n, 0), LIMITES.precioMax);
  return { valor: Math.round(acotado * 100) / 100, ajustado: acotado !== n };
}

function cleanInt(value, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

/* ---------- horario ---------- */

/** Minutos desde medianoche → "6:30 p.m." */
export function prettyTime(minutes) {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suf = h24 < 12 ? 'a.m.' : 'p.m.';
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, '0')} ${suf}`;
}

/**
 * Tramos cíclicos de días: [3,4,5,6,0,1] se lee "Miércoles a lunes", no
 * "Domingo, lunes, miércoles a sábado". La semana es circular y el horario de
 * un negocio se dice como lo diría una persona.
 * @param {number[]} days 0 = domingo
 */
export function describeDays(days) {
  const set = new Set(days);
  if (!set.size) return '';
  if (set.size === 7) return 'Todos los días';
  /* Se empieza a contar en el primer día abierto cuyo anterior esté cerrado:
     ahí arranca un tramo de verdad. */
  let start = -1;
  for (let d = 0; d < 7; d++) {
    if (set.has(d) && !set.has((d + 6) % 7)) {
      start = d;
      break;
    }
  }
  if (start < 0) start = [...set][0];
  const runs = [];
  let run = null;
  for (let i = 0; i < 7; i++) {
    const d = (start + i) % 7;
    if (set.has(d)) {
      if (run) run.push(d);
      else run = [d];
    } else if (run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  return runs
    .map((r) =>
      r.length === 1
        ? DIAS[r[0]]
        : r.length === 2
          ? `${DIAS[r[0]]} y ${DIAS[r[1]].toLowerCase()}`
          : `${DIAS[r[0]]} a ${DIAS[r[r.length - 1]].toLowerCase()}`
    )
    .join(', ');
}

/**
 * Horario legible derivado del horario real. Una sola fuente: si cambian los
 * días en el panel, el texto de "El local" cambia solo.
 * @param {{days:number[],from:number,to:number}} schedule
 */
export function describeSchedule(schedule) {
  if (!schedule || !schedule.days || !schedule.days.length) return [];
  const abiertos = describeDays(schedule.days);
  const cerrados = describeDays([0, 1, 2, 3, 4, 5, 6].filter((d) => !schedule.days.includes(d)));
  const out = [
    { days: abiertos, hours: `${prettyTime(schedule.from)} – ${prettyTime(schedule.to)}` }
  ];
  if (cerrados) out.push({ days: cerrados, hours: 'Cerrado' });
  return out;
}

/* ---------- normalización del documento ---------- */

/**
 * @param {any} raw documento recibido (panel, servidor o archivo importado)
 * @param {{images?: string[]}} [opts] slugs de foto admitidos
 * @returns {{doc:any, errors:string[]}}
 */
export function normalizeDoc(raw, opts = {}) {
  const errors = [];
  const imagenes = new Set(opts.images || []);
  const src = raw && typeof raw === 'object' ? raw : {};
  const add = (msg) => {
    if (errors.length < 40) errors.push(msg);
  };

  /* --- negocio --- */
  const b = src.business && typeof src.business === 'object' ? src.business : {};
  const whatsapp = String(b.whatsapp ?? '').replace(/\D/g, '');
  const phone = String(b.phone ?? '').replace(/\D/g, '');
  const days = Array.isArray(b.schedule?.days)
    ? [...new Set(b.schedule.days.map((d) => cleanInt(d, 0, 6)).filter((d) => d !== null))].sort()
    : [];
  let from = cleanInt(b.schedule?.from, 0, 1439);
  let to = cleanInt(b.schedule?.to, 0, 2880);
  /* Cerrar a la 1:00 significa la 1:00 del día siguiente, no un horario al
     revés: muchos negocios de alitas cierran pasada la medianoche. */
  if (from !== null && to !== null && to <= from) to += 1440;
  if (from === null || to === null || to <= from || to - from > 1440) {
    if (from !== null || to !== null)
      add('Horario inválido: revisa la hora de apertura y la de cierre.');
    from = null;
    to = null;
  }
  const mapsUrl = typeof b.mapsUrl === 'string' && /^https:\/\//.test(b.mapsUrl)
    ? cleanText(b.mapsUrl, 400)
    : '';
  if (b.mapsUrl && !mapsUrl) add('El enlace del mapa debe empezar por https://');
  if (whatsapp && (whatsapp.length < 8 || whatsapp.length > 15))
    add('El WhatsApp debe tener entre 8 y 15 dígitos, con la clave del país.');

  const business = {
    whatsapp: whatsapp.length >= 8 && whatsapp.length <= 15 ? whatsapp : '',
    phone: phone.slice(0, 15),
    address: cleanText(b.address, 200),
    mapsUrl,
    timeZone: cleanText(b.timeZone, 60) || 'America/Mexico_City',
    schedule: from !== null && days.length ? { days, from, to } : null,
    notice: cleanText(b.notice, 140)
  };

  /* --- fotos subidas desde el panel ---
     El panel redimensiona y codifica en el navegador; aquí sólo se admite la
     forma del manifiesto y rutas propias del sitio. */
  const images = {};
  const rawImages = src.images && typeof src.images === 'object' ? src.images : {};
  for (const [slug, entry] of Object.entries(rawImages)) {
    if (Object.keys(images).length >= LIMITES.fotos) break;
    if (!isId(slug)) continue;
    const variants = [];
    for (const v of (Array.isArray(entry?.variants) ? entry.variants : []).slice(0, LIMITES.variantes)) {
      const w = cleanInt(v?.w, 16, 4096);
      const hgt = cleanInt(v?.h, 16, 4096);
      const okSrc =
        typeof v?.src === 'string' && new RegExp('^(img|api/foto)/[a-z0-9-]+\\.webp$').test(v.src);
      if (w === null || hgt === null || !okSrc) continue;
      variants.push({ w, h: hgt, src: v.src });
    }
    if (!variants.length) continue;
    variants.sort((a, b) => a.w - b.w);
    const ratio = Number(entry?.ratio);
    images[slug] = {
      ratio: Number.isFinite(ratio) && ratio > 0.2 && ratio < 5 ? Math.round(ratio * 1e4) / 1e4 : 4 / 3,
      variants
    };
    imagenes.add(slug);
  }

  /* --- categorías --- */
  const categories = [];
  const catIds = new Set();
  for (const c of Array.isArray(src.categories) ? src.categories : []) {
    if (categories.length >= LIMITES.categorias) {
      add(`Sólo caben ${LIMITES.categorias} categorías.`);
      break;
    }
    const id = isId(c?.id) ? c.id : slugify(c?.name);
    if (!id) {
      add('Una categoría se quedó sin nombre y se descartó.');
      continue;
    }
    if (catIds.has(id)) {
      add(`Categoría repetida: ${id}`);
      continue;
    }
    catIds.add(id);
    categories.push({
      id,
      name: cleanText(c?.name, LIMITES.nombre) || id,
      kicker: cleanText(c?.kicker, 32),
      note: cleanText(c?.note, LIMITES.nota)
    });
  }

  /* --- grupos de opciones --- */
  const optionGroups = {};
  const rawGroups = src.optionGroups && typeof src.optionGroups === 'object' ? src.optionGroups : {};
  for (const [key, g] of Object.entries(rawGroups)) {
    if (Object.keys(optionGroups).length >= LIMITES.grupos) {
      add(`Sólo caben ${LIMITES.grupos} grupos de opciones.`);
      break;
    }
    if (!isId(key)) {
      add(`Grupo de opciones con clave inválida: ${String(key).slice(0, 20)}`);
      continue;
    }
    const choices = [];
    const seen = new Set();
    for (const ch of Array.isArray(g?.choices) ? g.choices : []) {
      if (choices.length >= LIMITES.opciones) break;
      const id = isId(ch?.id) ? ch.id : slugify(ch?.label);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const delta = cleanPrice(ch?.priceDelta ?? 0);
      const heat = cleanInt(ch?.heat, 0, 3);
      choices.push({
        id,
        label: cleanText(ch?.label, LIMITES.nombre) || id,
        priceDelta: delta === null ? 0 : delta.valor,
        ...(heat === null ? {} : { heat })
      });
    }
    if (!choices.length) {
      add(`El grupo "${cleanText(g?.label, 40) || key}" se quedó sin opciones y se descartó.`);
      continue;
    }
    optionGroups[key] = {
      /* El id ES la clave, siempre. Cuando varios grupos compartían el id
         "prep", elegir en dos de ellos en la misma ficha hacía que el segundo
         borrara la respuesta del primero y la comanda llegaba incompleta. */
      id: key,
      label: cleanText(g?.label, LIMITES.nombre) || key,
      hint: cleanText(g?.hint, 40),
      type: g?.type === 'multi' ? 'multi' : 'single',
      required: g?.required === true,
      choices
    };
  }

  /* --- productos --- */
  const products = [];
  const prodIds = new Set();
  for (const p of Array.isArray(src.products) ? src.products : []) {
    if (products.length >= LIMITES.productos) {
      add(`Sólo caben ${LIMITES.productos} productos.`);
      break;
    }
    const name = cleanText(p?.name, LIMITES.nombre);
    if (!name) {
      add('Un platillo sin nombre se descartó.');
      continue;
    }
    let id = isId(p?.id) ? p.id : slugify(name);
    if (!id) id = `p-${products.length + 1}`;
    if (prodIds.has(id)) {
      let n = 2;
      while (prodIds.has(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
    }
    prodIds.add(id);
    const price = cleanPrice(p?.basePrice);
    if (price === null) {
      add(`"${name}" tiene un precio inválido y se descartó.`);
      prodIds.delete(id);
      continue;
    }
    if (price.ajustado) add(`El precio de "${name}" se ajustó a $${price.valor}.`);
    const categoryId = catIds.has(p?.categoryId) ? p.categoryId : categories[0]?.id;
    if (!categoryId) {
      add(`"${name}" no pertenece a ninguna categoría.`);
      prodIds.delete(id);
      continue;
    }
    if (p?.categoryId && !catIds.has(p.categoryId))
      add(`"${name}" apuntaba a una categoría que no existe; se movió a "${categoryId}".`);
    const image = typeof p?.image === 'string' && imagenes.has(p.image) ? p.image : null;
    if (p?.image && !image) add(`La foto de "${name}" no existe; el platillo queda sin foto.`);
    const rank = ['hero', 'featured', 'regular'].includes(p?.rank) ? p.rank : 'regular';
    /* hasOwn y no `optionGroups[k]`: "constructor" o "toString" existen en
       cualquier objeto y pasarían el filtro, dejando luego un grupo
       inservible que rompe el catálogo en el teléfono del cliente. */
    const groups = (Array.isArray(p?.optionGroups) ? p.optionGroups : []).filter(
      (k) => typeof k === 'string' && Object.hasOwn(optionGroups, k)
    );
    products.push({
      id,
      categoryId,
      rank,
      name,
      kicker: cleanText(p?.kicker, 24),
      unit: cleanText(p?.unit, 24),
      description: cleanText(p?.description, LIMITES.descripcion),
      basePrice: price.valor,
      image,
      imageAlt: cleanText(p?.imageAlt, 160),
      optionGroups: [...new Set(groups)],
      available: p?.available !== false
    });
  }

  const doc = {
    schema: 1,
    updatedAt: typeof src.updatedAt === 'string' ? src.updatedAt : new Date().toISOString(),
    currency: cleanText(src.currency, 8) || 'MXN',
    business,
    categories,
    optionGroups,
    products,
    images
  };
  return { doc, errors };
}

/** Sólo las categorías que tienen algún producto visible, en orden. */
export function visibleCategories(doc) {
  return doc.categories.filter((c) => doc.products.some((p) => p.categoryId === c.id));
}
