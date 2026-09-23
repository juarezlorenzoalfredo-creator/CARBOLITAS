/**
 * ¿Está abierto ahora? Se calcula en la zona horaria del local, no en la del
 * teléfono del cliente: alguien que consulta la carta desde otro estado ve el
 * horario real de Carbolitas.
 */
import { BUSINESS } from '../config.js';
import { prettyTime } from './document.js';

const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const CLAVE = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Momento actual expresado en la zona horaria del local. */
export function localNow(date = new Date(), timeZone = BUSINESS.timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(date);
  } catch {
    // zona horaria desconocida: se cae a la hora del dispositivo
    return { weekday: date.getDay(), minutes: date.getHours() * 60 + date.getMinutes() };
  }
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const weekday = CLAVE.indexOf(get('weekday'));
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return {
    weekday: weekday === -1 ? date.getDay() : weekday,
    minutes: hour * 60 + minute
  };
}

/**
 * @returns {{open:boolean, label:string}} estado listo para pintar.
 */
export function openStatus(date = new Date(), schedule = BUSINESS.schedule) {
  if (!schedule || !Array.isArray(schedule.days) || !schedule.days.length) {
    return { open: false, label: '' };
  }
  const { weekday, minutes } = localNow(date);
  const cierre = schedule.to;
  const cruzaMedianoche = cierre > 1440;

  /* Sigue abierto de ayer: son las 00:30 y ayer cerraba a la 1:00. */
  if (cruzaMedianoche) {
    const ayer = (weekday + 6) % 7;
    if (schedule.days.includes(ayer) && minutes < cierre - 1440) {
      return { open: true, label: `Abierto · cierra ${prettyTime(cierre)}` };
    }
  }

  const abiertoHoy = schedule.days.includes(weekday);
  if (abiertoHoy && minutes >= schedule.from && minutes < Math.min(cierre, 1440)) {
    return { open: true, label: `Abierto · cierra ${prettyTime(cierre)}` };
  }
  if (abiertoHoy && minutes < schedule.from) {
    return { open: false, label: `Cerrado · abre hoy ${prettyTime(schedule.from)}` };
  }
  for (let salto = 1; salto <= 7; salto++) {
    const dia = (weekday + salto) % 7;
    if (!schedule.days.includes(dia)) continue;
    const cuando = salto === 1 ? 'mañana' : `el ${DIAS_LARGOS[dia]}`;
    return { open: false, label: `Cerrado · abre ${cuando} ${prettyTime(schedule.from)}` };
  }
  return { open: false, label: 'Cerrado' };
}
