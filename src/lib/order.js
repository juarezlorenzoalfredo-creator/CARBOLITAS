/**
 * Serialización del pedido: comanda en texto y enlace de WhatsApp.
 * Todo el contenido escrito por el cliente pasa antes por sanitizeText().
 */
import { BUSINESS, LIMITS } from '../config.js';
import { describeSelection } from './catalog.js';
import { sanitizeText } from './cart.js';
import { plainAmount } from './format.js';

const RULE = '- - - - - - - - - - - - - - -';

/**
 * @param {{lines:any[], subtotal:number}} state
 * @param {{name?:string, mode?:string}} customer
 */
export function buildOrderText(state, customer = {}) {
  const name = sanitizeText(customer.name, LIMITS.maxNameLength);
  const mode = BUSINESS.serviceModes.find((m) => m.id === customer.mode);
  const out = [`*${BUSINESS.name}* · Pedido`, ''];

  state.lines.forEach((line, index) => {
    const unit = line.product.unit ? ` (${line.product.unit})` : '';
    out.push(`${index + 1}. ${line.product.name}${unit} x${line.qty} — $${plainAmount(line.total)}`);
    for (const group of describeSelection(line.product, line.selection)) {
      out.push(`   ${group.groupLabel}: ${group.labels.join(', ')}`);
    }
    if (line.note) out.push(`   Nota: ${line.note}`);
  });

  out.push('', RULE, `TOTAL: $${plainAmount(state.subtotal)} ${BUSINESS.currency}`, '');
  if (mode) out.push(`Servicio: ${mode.label}`);
  if (name) out.push(`Nombre: ${name}`);
  return out.join('\n').trim();
}

/** Sólo dígitos, longitud plausible de número internacional. */
export function isValidPhone(phone) {
  return /^\d{8,15}$/.test(String(phone || '').replace(/\D/g, ''));
}

/**
 * @returns {string|null} null si el número del negocio aún no está configurado.
 */
export function buildWhatsappUrl(phone, text) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!isValidPhone(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(String(text))}`;
}
