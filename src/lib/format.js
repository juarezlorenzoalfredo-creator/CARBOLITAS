import { BUSINESS } from '../config.js';

const nf = new Intl.NumberFormat(BUSINESS.locale, {
  style: 'currency',
  currency: BUSINESS.currency,
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

/** $100 / $99.50 — sin decimales cuando el importe es entero. */
export function money(value) {
  return nf.format(Number(value || 0));
}

/** Importe plano para el mensaje de texto: "100" / "99.50". */
export function plainAmount(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
