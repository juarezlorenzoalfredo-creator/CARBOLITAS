/** Render del catálogo: tarjetas con fotografía, nombre y precio. */
import { money } from '../lib/format.js';
import { h } from './dom.js';
import { grillTile, heatDots, pictureFor } from './media.js';

const SIZES = {
  hero: '(min-width: 64rem) 34rem, (min-width: 48rem) 44vw, 92vw',
  card: '(min-width: 64rem) 18rem, (min-width: 48rem) 30vw, 46vw'
};

/** Salsas con color propio en el panel (clases, nunca estilos en línea: CSP). */
const SALSA_CLASS = new Set(['mango-habanero', 'bufalo', 'barbecue']);

function media(images, product, variant) {
  const inner = product.image
    ? pictureFor(images, product.image, {
        sizes: SIZES[variant],
        alt: product.imageAlt,
        priority: variant === 'hero'
      })
    : grillTile(product.name);
  return h('div.item__media', {}, [
    inner,
    product.available === false
      ? h('span.item__off', { text: 'Agotado' })
      : product.rank === 'hero' && product.kicker
        ? h('span.item__flag', { text: product.kicker })
        : null
  ]);
}

export function itemButton(images, product, onOpen) {
  const isHero = product.rank === 'hero';
  const agotado = product.available === false;
  const label = agotado
    ? `${product.name}, ${money(product.basePrice)}. Agotado por hoy`
    : `${product.name}, ${money(product.basePrice)}${
        product.unit ? `, ${product.unit}` : ''
      }. Personalizar y agregar al pedido`;

  return h(
    `button.item${isHero ? '.item--hero' : ''}${agotado ? '.item--off' : ''}`,
    {
      type: 'button',
      'aria-label': label,
      'aria-disabled': agotado ? 'true' : null,
      dataset: { product: product.id },
      on: { click: () => (agotado ? null : onOpen(product)) }
    },
    [
      media(images, product, isHero ? 'hero' : 'card'),
      h('div.item__body', {}, [
        h('div.item__text', {}, [
          h('h3.item__name', { text: product.name }),
          product.unit ? h('span.item__unit', { text: product.unit }) : null,
          isHero ? h('p.item__desc', { text: product.description }) : null
        ]),
        h('span.item__price', { text: money(product.basePrice) })
      ]),
      h('span.item__plus', { 'aria-hidden': 'true' })
    ]
  );
}

/** Panel "Nuestras salsas", con el nivel de picor de cada una. */
export function salsasPanel(catalog) {
  const group = catalog.products
    .map((p) => p.groups.find((g) => g.id === 'salsa'))
    .find(Boolean);
  if (!group) return null;
  return h('section.salsas-panel', { 'aria-labelledby': 'salsas-title' }, [
    h('h3', { id: 'salsas-title', text: 'Nuestras salsas' }),
    h(
      'ul.salsas',
      {},
      group.choices.map((c) =>
        h('li', {}, [
          h(`span.salsa__cup${SALSA_CLASS.has(c.id) ? `.salsa__cup--${c.id}` : ''}`, {
            'aria-hidden': 'true'
          }),
          h('span.salsa__name', {}, [h('b', { text: c.label }), heatDots(c.heat || 0)])
        ])
      )
    )
  ]);
}

export function categorySection(images, category, index, onOpen) {
  const titleId = `h-${category.id}`;
  return h('section.cat', { id: `cat-${category.id}`, 'aria-labelledby': titleId }, [
    h('div.cat__head', {}, [
      h('h2.cat__title', { id: titleId, text: category.name }),
      category.kicker ? h('span.cat__kicker', { text: category.kicker }) : null
    ]),
    category.note ? h('p.cat__note', { text: category.note }) : null,
    h(
      'div.cat__list',
      {},
      category.products.map((p) => itemButton(images, p, onOpen))
    )
  ]);
}
