/**
 * Motor de precios. ÚNICA fuente de cálculo de la aplicación: ficha de
 * producto, carrito, resumen y mensaje de WhatsApp llaman siempre aquí.
 *
 * Se trabaja en centavos enteros para no arrastrar errores de punto flotante.
 */
import { LIMITS } from '../config.js';

export const toCents = (value) => Math.round(Number(value || 0) * 100);
export const toPesos = (cents) => Math.round(cents) / 100;

/** @param {number} qty */
export function clampQty(qty) {
  const n = Math.floor(Number(qty));
  if (!Number.isFinite(n)) return LIMITS.minQty;
  return Math.min(LIMITS.maxQty, Math.max(LIMITS.minQty, n));
}

/**
 * Suma de los ajustes de precio de las opciones elegidas.
 * @param {import('./catalog.js').Product} product
 * @param {import('./catalog.js').Selection} selection
 */
export function optionsDeltaCents(product, selection) {
  let cents = 0;
  for (const group of product.groups) {
    const value = selection[group.id];
    const ids = Array.isArray(value) ? value : value ? [value] : [];
    for (const choice of group.choices) {
      if (ids.includes(choice.id)) cents += toCents(choice.priceDelta);
    }
  }
  return cents;
}

/** Precio de una unidad ya configurada. */
export function unitPriceCents(product, selection) {
  return Math.max(0, toCents(product.basePrice) + optionsDeltaCents(product, selection));
}

/** Precio de la línea completa. */
export function lineTotalCents(product, selection, qty) {
  return unitPriceCents(product, selection) * clampQty(qty);
}

/**
 * @param {{product:import('./catalog.js').Product,selection:any,qty:number}[]} lines
 * @returns {{count:number, subtotalCents:number, subtotal:number,
 *            lines:{unitCents:number,totalCents:number,unit:number,total:number}[]}}
 */
export function cartTotals(lines) {
  let subtotalCents = 0;
  let count = 0;
  const priced = lines.map((line) => {
    const qty = clampQty(line.qty);
    const unitCents = unitPriceCents(line.product, line.selection);
    const totalCents = unitCents * qty;
    subtotalCents += totalCents;
    count += qty;
    return { unitCents, totalCents, unit: toPesos(unitCents), total: toPesos(totalCents) };
  });
  return { count, subtotalCents, subtotal: toPesos(subtotalCents), lines: priced };
}
