import { describeSchedule } from './lib/document.js';

/**
 * Configuración del negocio.
 *
 * IMPORTANTE: los campos vacíos son datos que CARBOLITAS todavía no ha
 * proporcionado. No se inventan: la interfaz oculta la sección correspondiente
 * mientras el valor esté vacío.
 */

/** @typedef {{id:string,label:string}} ServiceMode */

export const BUSINESS = {
  name: 'CARBOLITAS',
  descriptor: 'Alitas al carbón',
  locale: 'es-MX',
  currency: 'MXN',

  /**
   * Número de WhatsApp en formato internacional, SOLO dígitos.
   * Ejemplo para México: '52' + LADA + número → '525512345678'.
   * Mientras esté vacío, el botón de pedido copia la comanda al portapapeles
   * en lugar de abrir WhatsApp.
   */
  whatsapp: '524471257475',

  /** Dirección del local. Vacío = la sección no se muestra. */
  address: 'Av. 16 de Septiembre 46, San Miguel Curahuango, 61253 Maravatío de Ocampo, Mich.',

  /** Enlace a Google Maps del local. */
  mapsUrl: 'https://maps.app.goo.gl/UfXuMFMgDF3gr5Z59',

  /** Teléfono para llamar (mismo que WhatsApp). */
  phone: '4471257475',

  /** Zona horaria del local: con ella se calcula si está abierto ahora. */
  timeZone: 'America/Mexico_City',

  /**
   * Horario real de atención.
   * days: 0 = domingo … 6 = sábado. Aquí: miércoles a lunes (martes cierra).
   * from/to en minutos desde medianoche.
   */
  schedule: { days: [0, 1, 3, 4, 5, 6], from: 18 * 60 + 30, to: 22 * 60 },

  /** Aviso puntual del día ("Hoy cerramos a las 9"). Vacío = no se muestra. */
  notice: '',

  /**
   * Cómo se lee el horario en la sección "El local". NO se escribe a mano:
   * lo deriva describeSchedule() de `schedule`, para que no puedan
   * contradecirse.
   */
  hours: [],

  /** Modos de servicio ofrecidos realmente. */
  serviceModes: /** @type {ServiceMode[]} */ ([
    { id: 'local', label: 'Comer aquí' },
    { id: 'llevar', label: 'Para llevar' }
  ])
};

/**
 * Aplica sobre BUSINESS los datos que llegan del panel. Se muta el mismo
 * objeto a propósito: todos los módulos tienen esta referencia, así que un
 * cambio publicado se ve en la carta, en la comanda y en el enlace de
 * WhatsApp sin recargar ni volver a cablear nada.
 * @param {any} patch business del documento ya normalizado
 */
export function applyBusiness(patch) {
  if (patch && typeof patch === 'object') {
    for (const key of ['whatsapp', 'phone', 'address', 'mapsUrl', 'timeZone', 'notice']) {
      if (typeof patch[key] === 'string') BUSINESS[key] = patch[key];
    }
    if ('schedule' in patch) BUSINESS.schedule = patch.schedule || null;
  }
  BUSINESS.hours = describeSchedule(BUSINESS.schedule);
  return BUSINESS;
}

export const LIMITS = {
  maxQty: 20,
  minQty: 1,
  maxNoteLength: 140,
  maxNameLength: 40,
  maxCartLines: 40
};

export const STORAGE_KEY = 'carbolitas.order.v1';

applyBusiness(null);
