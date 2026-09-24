/** Construye <img> responsive a partir del manifiesto generado por el pipeline. */
import { h } from './dom.js';

export function pictureFor(manifest, slug, { sizes, alt, priority = false, className = '' }) {
  const entry = manifest[slug];
  if (!entry) return null;
  const variants = entry.variants;
  const largest = variants[variants.length - 1];
  return h('img', {
    class: className,
    src: largest.src,
    srcset: variants.map((v) => `${v.src} ${v.w}w`).join(', '),
    sizes,
    width: largest.w,
    height: largest.h,
    alt: alt || '',
    decoding: 'async',
    loading: priority ? 'eager' : 'lazy',
    fetchpriority: priority ? 'high' : 'auto'
  });
}

/** Placa de parrilla tipográfica para los platos que aún no tienen fotografía. */
export function grillTile(name) {
  return h('div.grill', { 'aria-hidden': 'true' }, [h('span', { text: name.charAt(0) })]);
}

/** Indicador de picor: tres brasas inclinadas. */
export function heatDots(level) {
  return h(
    'span.heat',
    { role: 'img', 'aria-label': `Picor ${level} de 3` },
    [1, 2, 3].map((n) => h('i', { class: n <= level ? 'on' : '' }))
  );
}
