/**
 * Catálogo: resuelve el JSON crudo en un modelo consultable y valida
 * cualquier selección que llegue desde fuera (UI o almacenamiento local).
 *
 * @typedef {{id:string,label:string,priceDelta:number,heat?:number}} Choice
 * @typedef {{id:string,label:string,hint?:string,type:'single'|'multi',required:boolean,choices:Choice[]}} OptionGroup
 * @typedef {{id:string,categoryId:string,rank:'hero'|'featured'|'regular',name:string,kicker:string,
 *            unit:string,description:string,basePrice:number,image:string|null,imageAlt:string,
 *            gallery?:string[],groups:OptionGroup[],available:boolean}} Product
 * @typedef {Record<string, string|string[]>} Selection
 */

/**
 * @param {any} raw menu.json
 * @returns {{currency:string, categories:any[], products:Product[], byId:Map<string,Product>}}
 */
export function createCatalog(raw) {
  const groups = raw.optionGroups || {};
  const products = (raw.products || []).map((p) => ({
    ...p,
    groups: (p.optionGroups || [])
      .map((key) => (Object.hasOwn(groups, key) ? groups[key] : null))
      .filter((g) => g && Array.isArray(g.choices))
      .map((g) => ({ ...g, choices: g.choices.slice() }))
  }));
  const byId = new Map(products.map((p) => [p.id, p]));
  const categories = (raw.categories || []).map((c) => ({
    ...c,
    products: products.filter((p) => p.categoryId === c.id)
  }));
  return { currency: raw.currency || 'MXN', categories, products, byId };
}

/**
 * Devuelve una selección válida para el producto: descarta ids desconocidos y
 * respeta single/multi. Con fillRequired (por defecto) rellena los grupos
 * obligatorios con su primera opción — red de seguridad para datos guardados.
 * La ficha lo desactiva para que el cliente elija de forma explícita.
 * @param {Product} product
 * @param {any} raw
 * @param {{fillRequired?:boolean}} [opts]
 * @returns {Selection}
 */
export function normalizeSelection(product, raw, opts = {}) {
  const fillRequired = opts.fillRequired !== false;
  /** @type {Selection} */
  const out = {};
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  for (const group of product.groups) {
    const valid = new Set(group.choices.map((c) => c.id));
    const value = input[group.id];
    if (group.type === 'single') {
      const picked = typeof value === 'string' && valid.has(value) ? value : null;
      if (picked) out[group.id] = picked;
      else if (fillRequired && group.required && group.choices.length)
        out[group.id] = group.choices[0].id;
    } else {
      const list = Array.isArray(value) ? value : [];
      const picked = [];
      for (const choice of group.choices) {
        if (list.includes(choice.id)) picked.push(choice.id);
      }
      if (picked.length) out[group.id] = picked;
      else if (fillRequired && group.required && group.choices.length)
        out[group.id] = [group.choices[0].id];
    }
  }
  return out;
}

/**
 * Etiquetas legibles de una selección, en el orden del catálogo.
 * @param {Product} product @param {Selection} selection
 * @returns {{groupId:string,groupLabel:string,labels:string[]}[]}
 */
export function describeSelection(product, selection) {
  const out = [];
  for (const group of product.groups) {
    const value = selection[group.id];
    const ids = Array.isArray(value) ? value : value ? [value] : [];
    if (!ids.length) continue;
    const labels = group.choices.filter((c) => ids.includes(c.id)).map((c) => c.label);
    if (labels.length) out.push({ groupId: group.id, groupLabel: group.label, labels });
  }
  return out;
}

/** Clave estable de línea: mismo producto + misma configuración = misma línea. */
export function lineKey(productId, selection) {
  const parts = Object.keys(selection)
    .sort()
    .map((k) => {
      const v = selection[k];
      return `${k}=${(Array.isArray(v) ? v.slice().sort() : [v]).join('+')}`;
    });
  return [productId, ...parts].join('|');
}

/** Primer grupo obligatorio sin elegir, o null si la selección está completa. */
export function missingRequired(product, selection) {
  for (const group of product.groups) {
    if (!group.required) continue;
    const value = selection[group.id];
    const empty = Array.isArray(value) ? value.length === 0 : !value;
    if (empty) return group;
  }
  return null;
}
