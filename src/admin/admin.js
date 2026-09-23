/**
 * Panel administrativo de CARBOLITAS.
 *
 * Edita el mismo documento que consume la carta. Funciona de dos maneras
 * según lo que responda el sitio:
 *
 *   · con panel publicado  → entra con contraseña y publica en vivo;
 *   · sitio estático       → edita igual y descarga carta.json para subirlo.
 *
 * Nunca se inyecta HTML: todo el texto entra por textContent.
 */

const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
/* Sólo 'hero' cambia cómo se ve el platillo; 'featured' y 'regular' se pintan
   igual, así que ofrecer tres opciones era prometer algo que no pasa. */
const RANGOS = [
  { id: 'hero', label: 'Grande, con foto y descripción' },
  { id: 'regular', label: 'Normal' }
];
const ANCHOS = [320, 560, 900];
const CLAVE_BORRADOR = 'carbolitas.admin.borrador.v1';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, props = {}, children = []) {
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name || 'div');
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') node.textContent = String(v);
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'value') node.value = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
const vaciar = (n) => {
  while (n.firstChild) n.removeChild(n.firstChild);
};

/**
 * Repinta conservando la posición de la página.
 *
 * Vaciar una lista larga encoge el documento, el navegador recorta el scroll y
 * al volver a llenarla ya no se recupera: tocabas "agotado" en el último
 * platillo y la pantalla saltaba dos mil píxeles hacia arriba.
 */
function sinSaltar(fn) {
  const y = window.scrollY;
  fn();
  if (Math.abs(window.scrollY - y) > 2) window.scrollTo({ top: y, behavior: 'instant' });
}
const pesos = (n) => {
  const v = Number(n) || 0;
  return `$${v.toLocaleString('es-MX', {
    minimumFractionDigits: v % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  })}`;
};

/* ==================================================================
   estado
   ================================================================== */

const estado = {
  doc: null,
  base: null,
  modo: 'local', // 'live' | 'local'
  token: '',
  cartaPrecargada: null,
  sucio: false,
  abiertos: new Set(),
  slugsBase: []
};

function marcarSucio(si = true) {
  estado.sucio = si;
  const bar = $('#bar-state');
  bar.textContent = '';
  bar.append(
    el('b', { text: si ? 'Hay cambios sin publicar' : 'Todo publicado' }),
    el('span', {
      text: si
        ? estado.modo === 'live'
          ? 'Los clientes ven la carta anterior.'
          : 'Descarga el archivo y súbelo al sitio.'
        : `Publicado ${fecha(estado.doc?.updatedAt)}`
    })
  );
  $('#publicar').disabled = !si;
  if (si) guardarBorrador();
}

function fecha(iso) {
  if (!iso) return 'nunca';
  try {
    return new Date(iso).toLocaleString('es-MX', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

/**
 * Copia de seguridad del trabajo sin publicar.
 *
 * Se aplaza medio segundo: serializar la carta entera en cada tecla se nota
 * en un teléfono viejo cuando el menú es largo, y lo que importa es que esté
 * guardada cuando deje de escribir, no en cada letra.
 */
let borradorTimer = 0;
function guardarBorrador() {
  clearTimeout(borradorTimer);
  borradorTimer = setTimeout(() => {
    try {
      localStorage.setItem(CLAVE_BORRADOR, JSON.stringify(estado.doc));
    } catch {
      /* sin almacenamiento el panel sigue funcionando, sólo sin red de seguridad */
    }
  }, 500);
}
function borrarBorrador() {
  /* Se cancela el guardado aplazado: si no, volvería a escribir el borrador
     medio segundo después de haberlo borrado. */
  clearTimeout(borradorTimer);
  try {
    localStorage.removeItem(CLAVE_BORRADOR);
  } catch {
    /* nada que borrar */
  }
}

let toastTimer = 0;
function toast(texto) {
  const t = $('#toast');
  t.textContent = texto;
  t.dataset.on = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.dataset.on = 'false'), 2800);
}

function aviso(tipo, texto, lista) {
  const box = $('#aviso');
  box.className = `msg msg--${tipo}`;
  vaciar(box);
  box.append(el('span', { text: texto }));
  if (lista && lista.length) {
    box.append(el('ul', {}, lista.map((t) => el('li', { text: t }))));
  }
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
const limpiarAviso = () => ($('#aviso').hidden = true);

/* ==================================================================
   red
   ================================================================== */

/** Traduce los mensajes que vienen del navegador, no del servidor. */
function enEspanol(mensaje) {
  const texto = String(mensaje || '');
  if (/Failed to fetch|NetworkError|Load failed/i.test(texto)) {
    return 'No se pudo conectar con el sitio. Revisa tu conexión y vuelve a intentarlo; tus cambios siguen aquí.';
  }
  if (/^Error 5\d\d$/.test(texto)) {
    return 'El sitio no respondió bien. Espera un momento y vuelve a intentarlo.';
  }
  if (/^Error 40\d$/.test(texto)) return 'La sesión ya no es válida. Vuelve a entrar.';
  return texto;
}

async function pedir(ruta, opciones = {}) {
  const res = await fetch(ruta, {
    ...opciones,
    headers: {
      'content-type': 'application/json',
      ...(estado.token ? { authorization: `Bearer ${estado.token}` } : {}),
      ...(opciones.headers || {})
    }
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}

/**
 * ¿Este sitio tiene las funciones publicadas?
 *
 * La función de la carta marca su respuesta con una cabecera propia. Un
 * archivo estático no la lleva. Así se sabe en qué modo estamos sin provocar
 * peticiones fallidas ni errores en la consola.
 */
async function detectarModo() {
  try {
    const res = await fetch('carta.json', { cache: 'no-store' });
    if (res.ok && res.headers.get('x-carbolitas-panel') === '1') {
      estado.modo = 'live';
      estado.cartaPrecargada = await res.json();
      return;
    }
    if (res.ok) estado.cartaPrecargada = await res.json();
  } catch {
    /* sin red: modo local */
  }
  estado.modo = 'local';
}

/* ==================================================================
   carga
   ================================================================== */

async function cargarCarta() {
  if (estado.cartaPrecargada) {
    const d = estado.cartaPrecargada;
    return Array.isArray(d?.products) ? d : d?.doc || null;
  }
  try {
    const res = await fetch('carta.json', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const crudo = Array.isArray(data?.products) ? data : data?.doc;
      if (crudo) return crudo;
    }
  } catch {
    /* se intenta con el respaldo */
  }
  try {
    const res = await fetch('carta-base.json', { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {
    /* nada que cargar */
  }
  return null;
}

function slugsDisponibles() {
  return [...new Set([...estado.slugsBase, ...Object.keys(estado.doc.images || {})])];
}

function renormalizar() {
  const { doc, errors } = normalizeDoc(estado.doc, { images: slugsDisponibles() });
  estado.doc = doc;
  return errors;
}

/* ==================================================================
   pestaña: platillos
   ================================================================== */

function campo(label, input, ayuda) {
  return el('div.f', {}, [el('label', { text: label }), input, ayuda ? el('small', { text: ayuda }) : null]);
}

function entrada(valor, onInput, extra = {}) {
  return el('input', {
    value: valor ?? '',
    ...extra,
    on: { input: (e) => onInput(e.target.value) }
  });
}

function pintarPlatillos() {
  sinSaltar(() => repintarPlatillos());
}

function repintarPlatillos() {
  const cont = $('#lista-platillos');
  vaciar(cont);
  const cats = estado.doc.categories;

  for (const cat of cats) {
    const delCat = estado.doc.products.filter((p) => p.categoryId === cat.id);
    const grupo = el('section.catgroup', { dataset: { catgroup: cat.id } }, [
      el('h3', { text: cat.name })
    ]);
    if (!delCat.length) {
      grupo.append(el('p.sec', { text: 'Sin platillos todavía.' }));
    }
    delCat.forEach((prod, i) => grupo.append(tarjetaProducto(prod, i, delCat.length)));
    grupo.append(
      el(
        'button.btn.btn-add-cat',
        {
          type: 'button',
          on: {
            click: () => {
              const nuevo = {
                id: `nuevo-${Date.now().toString(36)}`,
                categoryId: cat.id,
                rank: 'regular',
                name: 'Platillo nuevo',
                kicker: '',
                unit: '',
                description: '',
                basePrice: 0,
                image: null,
                imageAlt: '',
                optionGroups: [],
                available: true
              };
              estado.doc.products.push(nuevo);
              estado.abiertos.add(nuevo.id);
              marcarSucio();
              pintarPlatillos();
              const campoNombre = $(`[data-card="${nuevo.id}"] input`);
              if (campoNombre) {
                campoNombre.focus();
                campoNombre.select();
              }
            }
          }
        },
        [`+ Agregar a ${cat.name}`]
      )
    );
    cont.append(grupo);
  }
}

function tarjetaProducto(prod, indice, total) {
  const abierto = estado.abiertos.has(prod.id);
  const cuerpo = el('div.card__body', { hidden: !abierto });

  const tarjeta = el(`div.card${prod.available === false ? '.card--off' : ''}`, {
    dataset: { card: prod.id }
  });

  const mover = (paso) => {
    const hermanos = estado.doc.products.filter((p) => p.categoryId === prod.categoryId);
    const destino = hermanos[indice + paso];
    if (!destino) return;
    const a = estado.doc.products.indexOf(prod);
    const b = estado.doc.products.indexOf(destino);
    estado.doc.products[a] = destino;
    estado.doc.products[b] = prod;
    marcarSucio();
    pintarPlatillos();
  };

  const titulo = el('button.card__title', {
    type: 'button',
    'aria-expanded': String(abierto),
    on: {
      click: () => {
        if (estado.abiertos.has(prod.id)) estado.abiertos.delete(prod.id);
        else estado.abiertos.add(prod.id);
        pintarPlatillos();
      }
    }
  }, [
    el('b', { text: prod.name }),
    el('span', {
      text: [prod.unit, prod.available === false ? 'Agotado' : null].filter(Boolean).join(' · ') || ' '
    })
  ]);

  tarjeta.append(
    el('div.card__head', {}, [
      titulo,
      el('span.card__price', { text: pesos(prod.basePrice) }),
      el(
        'button.stock',
        {
          type: 'button',
          'aria-pressed': String(prod.available !== false),
          'aria-label': `${prod.name}: ${
            prod.available === false ? 'agotado, tocar para reponer' : 'disponible, tocar para agotar'
          }`,
          on: { click: () => alternarExistencia(prod) }
        },
        [el('span.stock__txt', { text: prod.available === false ? 'Se acabó' : 'Sí hay' })]
      ),
      el('span.chev', { 'aria-hidden': 'true', text: abierto ? '▲' : '▼' })
    ]),
    cuerpo
  );

  if (!abierto) return tarjeta;

  const rejilla = el('div.grid2');
  rejilla.append(
    campo(
      'Nombre',
      entrada(
        prod.name,
        (v) => {
          prod.name = v;
          titulo.firstChild.textContent = v || 'Sin nombre';
          tarjeta.classList.toggle('card--mal', !v.trim());
          marcarSucio();
        },
        { maxlength: 60, 'aria-label': 'Nombre del platillo' }
      ),
      'Sin nombre no se puede publicar.'
    ),
    campo(
      'Precio',
      entrada(
        prod.basePrice,
        (v) => {
          /* Texto y no number: el teclado numérico en español ofrece coma, y
             <input type=number> la descarta en silencio, así que "30,50"
             llegaba como 3050. Aquí la coma y el punto valen igual. */
          const n = Number(String(v).replace(',', '.').replace(/[^\d.]/g, ''));
          prod.basePrice = Number.isFinite(n) && n >= 0 ? n : 0;
          $('.card__price', tarjeta).textContent = pesos(prod.basePrice);
          marcarSucio();
        },
        { type: 'text', inputmode: 'decimal', maxlength: 9, 'aria-label': 'Precio en pesos' }
      ),
      'En pesos, sin el signo. Se pueden poner centavos: 99.50'
    ),
    campo(
      'Medida',
      entrada(prod.unit, (v) => {
        prod.unit = v;
        marcarSucio();
      }, { maxlength: 24, placeholder: '7 piezas, orden…' }),
      'Se lee debajo del nombre. Déjalo vacío si no aplica.'
    ),
    campo(
      'Etiqueta',
      entrada(prod.kicker, (v) => {
        prod.kicker = v;
        marcarSucio();
      }, { maxlength: 24, placeholder: 'La casa, Doble carne…' }),
      'Aparece sobre la foto en los platillos grandes y en la ficha del platillo.'
    ),
    campo(
      'Categoría',
      selector(
        estado.doc.categories.map((c) => ({ id: c.id, label: c.name })),
        prod.categoryId,
        (v) => {
          prod.categoryId = v;
          marcarSucio();
          pintarPlatillos();
          toast(`Movido a ${estado.doc.categories.find((c) => c.id === v)?.name || v}`);
        }
      )
    ),
    campo(
      'Tamaño en la carta',
      selector(RANGOS, prod.rank, (v) => {
        prod.rank = v;
        marcarSucio();
      }),
      'Destacado grande ocupa el ancho completo y muestra la descripción.'
    )
  );

  const desc = el('textarea', {
    maxlength: 320,
    value: prod.description,
    on: {
      input: (e) => {
        prod.description = e.target.value;
        marcarSucio();
      }
    }
  });
  rejilla.append(el('div.f.full', {}, [el('label', { text: 'Descripción' }), desc]));
  cuerpo.append(rejilla);

  cuerpo.append(bloqueFoto(prod));
  cuerpo.append(bloqueOpciones(prod));

  cuerpo.append(
    el('div.f', {}, [
      el('label', { text: 'Orden dentro de la categoría' }),
      el('div.row', {}, [
        el('button.btn', {
          type: 'button',
          text: '↑  Subir',
          disabled: indice === 0,
          on: { click: () => mover(-1) }
        }),
        el('button.btn', {
          type: 'button',
          text: '↓  Bajar',
          disabled: indice === total - 1,
          on: { click: () => mover(1) }
        }),
        el('span.orden', { text: `${indice + 1} de ${total}` })
      ]),
      el('small', { text: 'Lo primero de la primera categoría es lo primero que ve el cliente.' })
    ])
  );

  cuerpo.append(
    el('div.row', {}, [
      el(
        'button.switch.switch--stock',
        {
          type: 'button',
          'aria-pressed': String(prod.available !== false),
          on: { click: () => alternarExistencia(prod) }
        },
        [prod.available === false ? 'Agotado' : 'Disponible']
      ),
      el('span.spacer'),
      el(
        'button.btn.btn--danger',
        {
          type: 'button',
          on: {
            click: () => {
              if (!confirm(`¿Quitar "${prod.name}" de la carta?`)) return;
              estado.doc.products = estado.doc.products.filter((p) => p !== prod);
              marcarSucio();
              pintarPlatillos();
              toast('Platillo quitado. Publica para que se note.');
            }
          }
        },
        ['Quitar de la carta']
      )
    ])
  );

  return tarjeta;
}

/**
 * Agotar o reponer un platillo. Es lo que más se toca en un día normal, así
 * que se actualiza sólo esta tarjeta: repintar la lista entera movía la
 * pantalla justo cuando acababa de tocar el botón.
 */
function alternarExistencia(prod) {
  prod.available = prod.available === false;
  marcarSucio();
  const tarjeta = $(`[data-card="${prod.id}"]`);
  if (tarjeta) {
    tarjeta.classList.toggle('card--off', prod.available === false);
    const dot = $('.stock', tarjeta);
    if (dot) {
      dot.setAttribute('aria-pressed', String(prod.available !== false));
      $('.stock__txt', dot).textContent = prod.available === false ? 'Se acabó' : 'Sí hay';
    }
    const interruptor = $('.switch--stock', tarjeta);
    if (interruptor) {
      interruptor.setAttribute('aria-pressed', String(prod.available !== false));
      interruptor.textContent = prod.available === false ? 'Agotado' : 'Disponible';
    }
  } else {
    pintarPlatillos();
  }
  toast(prod.available ? `${prod.name}: vuelve a la carta` : `${prod.name}: agotado`);
}

function selector(opciones, valor, onChange) {
  return el(
    'select',
    { on: { change: (e) => onChange(e.target.value) } },
    opciones.map((o) =>
      el('option', { value: o.id, selected: o.id === valor ? true : null, text: o.label })
    )
  );
}

/** Qué platillos usan un grupo de opciones: es lo que lo distingue de otro. */
function usadoPor(clave) {
  const nombres = estado.doc.products
    .filter((p) => p.optionGroups.includes(clave))
    .map((p) => p.name);
  if (!nombres.length) return 'sin platillos';
  return nombres.length > 3 ? `${nombres.slice(0, 3).join(', ')}…` : nombres.join(', ');
}

function bloqueOpciones(prod) {
  const claves = Object.keys(estado.doc.optionGroups);
  if (!claves.length) return el('div');
  return el('div.f', {}, [
    el('label', { text: 'Preguntas al pedir' }),
    el(
      'div.row',
      {},
      claves.map((k) => {
        const g = estado.doc.optionGroups[k];
        const puesto = prod.optionGroups.includes(k);
        return el(
          'button.switch',
          {
            type: 'button',
            'aria-pressed': String(puesto),
            title: `Se usa en: ${usadoPor(k)}`,
            on: {
              click: (e) => {
                const on = prod.optionGroups.includes(k);
                prod.optionGroups = on
                  ? prod.optionGroups.filter((x) => x !== k)
                  : [...prod.optionGroups, k];
                e.currentTarget.setAttribute('aria-pressed', String(!on));
                marcarSucio();
              }
            }
          },
          [`${g.label} · ${usadoPor(k)}`]
        );
      })
    ),
    el('small', {
      text: 'Lo que el cliente elige antes de agregar el platillo. El texto en gris dice en qué platillos se usa cada uno.'
    })
  ]);
}

function bloqueFoto(prod) {
  const entry = (estado.doc.images || {})[prod.image] || null;
  const src = entry
    ? entry.variants[0].src
    : prod.image
      ? `img/${prod.image}-320.webp`
      : null;

  const vista = src
    ? el('img.foto__thumb', { src, alt: '', width: 88, height: 66 })
    : el('div.foto__none', { text: 'Sin foto' });

  const file = el('input', {
    type: 'file',
    accept: 'image/*',
    class: 'sr-only',
    id: `foto-${prod.id}`,
    on: { change: (e) => subirFoto(prod, e.target.files?.[0]) }
  });

  const acciones = el('div.row', {}, [
    el('label.btn', { for: `foto-${prod.id}`, text: 'Cambiar foto' }),
    prod.image
      ? el('button.btn.btn--ghost', {
          type: 'button',
          text: 'Quitar foto',
          on: {
            click: () => {
              prod.image = null;
              marcarSucio();
              pintarPlatillos();
            }
          }
        })
      : null
  ]);

  return el('div.f', {}, [
    el('label', { text: 'Foto' }),
    el('div.foto', {}, [vista, el('div', {}, [acciones, file])]),
    el('small', {
      text:
        estado.modo === 'live'
          ? 'Se recorta a 4:3 y se reduce en tu teléfono antes de subirse: pesa poco y carga rápido.'
          : 'Aquí sólo puedes elegir entre las fotos que ya trae la carta.'
    }),
    selectorFotoExistente(prod)
  ]);
}

function selectorFotoExistente(prod) {
  /* Los identificadores de foto no le dicen nada a nadie: se muestran por el
     platillo que ya las usa. */
  const nombrePorSlug = new Map();
  for (const p of estado.doc.products) {
    if (p.image && !nombrePorSlug.has(p.image)) nombrePorSlug.set(p.image, p.name);
  }
  const opciones = [{ id: '', label: 'Sin foto' }].concat(
    slugsDisponibles()
      .filter((s) => !['logo', 'portada', 'portada-alta', 'local'].includes(s))
      .map((s) => ({ id: s, label: nombrePorSlug.get(s) ? `Foto de ${nombrePorSlug.get(s)}` : s }))
  );
  return selector(opciones, prod.image || '', (v) => {
    prod.image = v || null;
    marcarSucio();
    pintarPlatillos();
  });
}

/* --- redimensionado en el navegador --- */

async function subirFoto(prod, archivo) {
  if (!archivo) return;
  if (estado.modo !== 'live') {
    aviso(
      'warn',
      'Para subir fotos nuevas, el sitio tiene que estar publicado con el panel en vivo. Mientras tanto puedes elegir una de las fotos que ya trae la carta.'
    );
    return;
  }
  if (!estado.token) {
    aviso('bad', 'Entra con la contraseña antes de subir fotos.');
    return;
  }
  try {
    toast('Preparando la foto…');
    const bitmap = await cargarImagen(archivo);
    const variants = [];
    for (const w of ANCHOS) {
      const v = await recortar(bitmap, w);
      if (v) variants.push(v);
    }
    if (!variants.length) throw new Error('No se pudo procesar la imagen.');
    const slug = `${slugify(prod.name) || 'foto'}-${Date.now().toString(36)}`.slice(0, 40);
    const r = await pedir('api/foto', {
      method: 'POST',
      body: JSON.stringify({ slug, variants })
    });
    estado.doc.images = estado.doc.images || {};
    estado.doc.images[r.slug] = r.entry;
    prod.image = r.slug;
    prod.imageAlt = prod.imageAlt || `Foto de ${prod.name}`;
    marcarSucio();
    pintarPlatillos();
    toast('Foto lista. Publica para que se vea.');
  } catch (err) {
    aviso('bad', `No se pudo subir la foto: ${err.message}`);
  }
}

function cargarImagen(archivo) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(archivo);
  return new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => no(new Error('formato no reconocido'));
    img.src = URL.createObjectURL(archivo);
  });
}

/** Recorta al centro en 4:3 y devuelve un WebP en base64. */
async function recortar(bitmap, ancho) {
  const alto = Math.round((ancho * 3) / 4);
  const sw = bitmap.width;
  const sh = bitmap.height;
  if (!sw || !sh) return null;
  let cw = sw;
  let ch = Math.round((sw * 3) / 4);
  if (ch > sh) {
    ch = sh;
    cw = Math.round((sh * 4) / 3);
  }
  const canvas = document.createElement('canvas');
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, Math.round((sw - cw) / 2), Math.round((sh - ch) / 2), cw, ch, 0, 0, ancho, alto);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.78));
  if (!blob || blob.type !== 'image/webp') return null;
  const buf = await blob.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return { w: ancho, h: alto, data: btoa(bin) };
}

/* ==================================================================
   pestaña: categorías
   ================================================================== */

function pintarCategorias() {
  sinSaltar(() => repintarCategorias());
}

function repintarCategorias() {
  const cont = $('#lista-categorias');
  vaciar(cont);
  estado.doc.categories.forEach((cat, i) => {
    const usados = estado.doc.products.filter((p) => p.categoryId === cat.id).length;
    const cuerpo = el('div.card__body', {}, [
      el('div.grid2', {}, [
        campo('Nombre', entrada(cat.name, (v) => {
          cat.name = v;
          marcarSucio();
          $('b', tarjeta).textContent = v;
          /* La pestaña de platillos agrupa por categoría: si no se actualiza
             aquí, se queda con el nombre viejo y parece que no se guardó. */
          const encabezado = $(`[data-catgroup="${cat.id}"] h3`);
          if (encabezado) encabezado.textContent = v || 'Sin nombre';
          const agregar = $(`[data-catgroup="${cat.id}"] .btn-add-cat`);
          if (agregar) agregar.textContent = `+ Agregar a ${v || 'esta categoría'}`;
        }, { maxlength: 60 })),
        campo('Etiqueta', entrada(cat.kicker, (v) => {
          cat.kicker = v;
          marcarSucio();
        }, { maxlength: 32, placeholder: 'Al carbón, Sin hueso…' })),
        el('div.f.full', {}, [
          el('label', { text: 'Nota' }),
          el('textarea', {
            maxlength: 240,
            value: cat.note,
            on: {
              input: (e) => {
                cat.note = e.target.value;
                marcarSucio();
              }
            }
          }),
          el('small', { text: 'Línea explicativa debajo del título de la sección.' })
        ])
      ]),
      el('div.row.row--end', {}, [
        usados > 0
          ? el('small', {
              text: `Para quitar esta categoría, primero mueve o quita sus ${usados} platillo${
                usados === 1 ? '' : 's'
              }.`
            })
          : null,
        el('button.btn.btn--danger', {
          type: 'button',
          disabled: usados > 0,
          text: 'Quitar categoría',
          on: {
            click: () => {
              if (usados > 0) return;
              if (!confirm(`¿Quitar la categoría "${cat.name}" de la carta?`)) return;
              estado.doc.categories = estado.doc.categories.filter((c) => c !== cat);
              marcarSucio();
              pintarCategorias();
            }
          }
        })
      ])
    ]);

    const mover = (paso) => {
      const j = i + paso;
      if (j < 0 || j >= estado.doc.categories.length) return;
      const arr = estado.doc.categories;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      marcarSucio();
      pintarCategorias();
    };

    const tarjeta = el('div.card', {}, [
      el('div.card__head', {}, [
        el('div.card__grab', {}, [
          el('button', {
            type: 'button',
            text: '▲',
            'aria-label': `Subir ${cat.name}`,
            disabled: i === 0,
            on: { click: () => mover(-1) }
          }),
          el('button', {
            type: 'button',
            text: '▼',
            'aria-label': `Bajar ${cat.name}`,
            disabled: i === estado.doc.categories.length - 1,
            on: { click: () => mover(1) }
          })
        ]),
        el('div.card__title', {}, [
          el('b', { text: cat.name }),
          el('span', { text: `${usados} platillo${usados === 1 ? '' : 's'}` })
        ])
      ]),
      cuerpo
    ]);
    cont.append(tarjeta);
  });

  cont.append(
    el('button.btn', {
      type: 'button',
      text: '+ Agregar categoría',
      on: {
        click: () => {
          estado.doc.categories.push({
            id: `cat-${Date.now().toString(36)}`,
            name: 'Categoría nueva',
            kicker: '',
            note: ''
          });
          marcarSucio();
          pintarCategorias();
        }
      }
    })
  );
}

/* ==================================================================
   pestaña: salsas y opciones
   ================================================================== */

function pintarOpciones() {
  const cont = $('#lista-opciones');
  vaciar(cont);
  for (const [clave, grupo] of Object.entries(estado.doc.optionGroups)) {
    const lista = el('div', {}, []);
    const repintar = () => {
      vaciar(lista);
      grupo.choices.forEach((ch, i) => {
        lista.append(
          el('div.row', {}, [
            el('div.grow', {}, [
              entrada(ch.label, (v) => {
                ch.label = v;
                marcarSucio();
              }, { maxlength: 60, 'aria-label': 'Nombre de la opción' })
            ]),
            grupo.id === 'salsa'
              ? el('div.f.narrow', {}, [
                  selector(
                    [
                      { id: '0', label: 'Sin picor' },
                      { id: '1', label: 'Picor 1' },
                      { id: '2', label: 'Picor 2' },
                      { id: '3', label: 'Picor 3' }
                    ],
                    String(ch.heat ?? 0),
                    (v) => {
                      ch.heat = Number(v);
                      marcarSucio();
                    }
                  )
                ])
              : null,
            el('button.btn.btn--danger', {
              type: 'button',
              text: 'Quitar',
              disabled: grupo.choices.length <= 1,
              on: {
                click: () => {
                  if (!confirm(`¿Quitar "${ch.label}" de "${grupo.label}"?`)) return;
                  grupo.choices.splice(i, 1);
                  marcarSucio();
                  repintar();
                }
              }
            })
          ])
        );
      });
      lista.append(
        el('button.btn', {
          type: 'button',
          text: '+ Agregar opción',
          on: {
            click: () => {
              grupo.choices.push({
                id: `op-${Date.now().toString(36)}`,
                label: 'Opción nueva',
                priceDelta: 0,
                ...(grupo.id === 'salsa' ? { heat: 0 } : {})
              });
              marcarSucio();
              repintar();
            }
          }
        })
      );
    };
    repintar();

    cont.append(
      el('div.card', {}, [
        el('div.card__head', {}, [
          el('div.card__title', {}, [
            el('b', { text: grupo.label }),
            el('span', {
              text: `${grupo.type === 'single' ? 'Elige una' : 'Puede elegir varias'}${
                grupo.required ? ' · obligatorio' : ''
              } · ${usadoPor(clave)}`
            })
          ])
        ]),
        el('div.card__body', {}, [
          campo(
            'Cómo se titula en la ficha',
            entrada(grupo.label, (v) => {
              grupo.label = v;
              marcarSucio();
            }, { maxlength: 60 })
          ),
          el('div.f', {}, [el('label', { text: 'Opciones' }), lista])
        ])
      ])
    );
  }
}

/* ==================================================================
   pestaña: negocio
   ================================================================== */

function pintarNegocio() {
  const cont = $('#form-negocio');
  vaciar(cont);
  const b = estado.doc.business;

  const horaInput = (valor, onChange) =>
    el('input', {
      type: 'time',
      value: `${String(Math.floor(valor / 60)).padStart(2, '0')}:${String(valor % 60).padStart(2, '0')}`,
      on: {
        change: (e) => {
          const [h, m] = String(e.target.value || '').split(':').map(Number);
          if (Number.isFinite(h) && Number.isFinite(m)) onChange(h * 60 + m);
          marcarSucio();
        }
      }
    });

  b.schedule = b.schedule || { days: [], from: 18 * 60, to: 22 * 60 };

  const resumen = el('small', {});
  const refrescarResumen = () => {
    const lineas = describeSchedule(b.schedule);
    resumen.textContent = lineas.length
      ? lineas.map((l) => `${l.days}: ${l.hours}`).join('   ·   ')
      : 'Sin días marcados no se muestra horario en la carta.';
  };

  cont.append(
    el('div.grid2', {}, [
      campo(
        'WhatsApp para pedidos',
        entrada(b.whatsapp, (v) => {
          b.whatsapp = v.replace(/\D/g, '');
          marcarSucio();
        }, { inputmode: 'numeric', maxlength: 15 }),
        'Con clave de país y sin espacios. México: 52 + LADA + número.'
      ),
      campo(
        'Teléfono que se muestra',
        entrada(b.phone, (v) => {
          b.phone = v.replace(/\D/g, '');
          marcarSucio();
        }, { inputmode: 'numeric', maxlength: 15 }),
        'Los 10 dígitos locales. Es el que aparece escrito en la carta.'
      ),
      el('div.f.full', {}, [
        el('label', { text: 'Dirección' }),
        entrada(b.address, (v) => {
          b.address = v;
          marcarSucio();
        }, { maxlength: 200 })
      ]),
      el('div.f.full', {}, [
        el('label', { text: 'Enlace de Google Maps' }),
        entrada(b.mapsUrl, (v) => {
          b.mapsUrl = v.trim();
          marcarSucio();
        }, { maxlength: 400, placeholder: 'https://maps.app.goo.gl/…' }),
        el('small', { text: 'Tiene que empezar por https://' })
      ]),
      el('div.f.full', {}, [
        el('label', { text: 'Aviso del día' }),
        entrada(b.notice, (v) => {
          b.notice = v;
          marcarSucio();
        }, { maxlength: 140, placeholder: 'Hoy cerramos a las 9:30' }),
        el('small', { text: 'Sale arriba de la carta, resaltado. Déjalo vacío para quitarlo.' })
      ])
    ])
  );

  cont.append(
    el('h2.sec', { text: 'Horario' }),
    el('p.sec', {
      text: 'Marca los días que abres. La carta usa esto para decir si está abierto ahora mismo.'
    }),
    el(
      'div.dias',
      {},
      DIAS_CORTOS.map((nombre, d) =>
        el(
          'button.dia',
          {
            type: 'button',
            'aria-pressed': String(b.schedule.days.includes(d)),
            on: {
              click: (e) => {
                const on = b.schedule.days.includes(d);
                b.schedule.days = on
                  ? b.schedule.days.filter((x) => x !== d)
                  : [...b.schedule.days, d].sort();
                e.currentTarget.setAttribute('aria-pressed', String(!on));
                marcarSucio();
                refrescarResumen();
              }
            }
          },
          [nombre]
        )
      )
    ),
    el('div.grid2.mt', {}, [
      campo('Abre', horaInput(b.schedule.from, (v) => {
        b.schedule.from = v;
        refrescarResumen();
      })),
      campo('Cierra', horaInput(b.schedule.to, (v) => {
        b.schedule.to = v;
        refrescarResumen();
      }))
    ]),
    el('div.f', {}, [el('label', { text: 'Así se leerá' }), resumen])
  );
  refrescarResumen();
}

/* ==================================================================
   pestaña: respaldo
   ================================================================== */

function pintarRespaldo() {
  const cont = $('#form-respaldo');
  vaciar(cont);
  cont.append(
    el('p.sec', {
      text:
        'Descarga una copia antes de cambios grandes. El archivo es la carta completa: si algo sale mal, lo vuelves a cargar aquí y publicas.'
    }),
    el('div.row', {}, [
      el('button.btn', { type: 'button', text: 'Descargar carta.json', on: { click: descargar } }),
      el('label.btn', { for: 'importar', text: 'Cargar un archivo' }),
      el('input', {
        type: 'file',
        id: 'importar',
        accept: 'application/json,.json',
        class: 'sr-only',
        on: { change: (e) => importar(e.target.files?.[0]) }
      })
    ]),
    el('h2.sec', { text: 'Deshacer' }),
    el('p.sec', {
      text: 'Dos formas de volver atrás, según lo lejos que quieras ir.'
    }),
    el('div.row', {}, [
      el('button.btn', {
        type: 'button',
        text: 'Descartar lo que no he publicado',
        on: {
          click: () => {
            if (!confirm('¿Descartar los cambios que todavía no has publicado?')) return;
            estado.doc = JSON.parse(JSON.stringify(estado.base));
            borrarBorrador();
            pintarTodo();
            marcarSucio(false);
            toast('Cambios descartados.');
          }
        }
      }),
      el('button.btn.btn--danger', {
        type: 'button',
        text: 'Volver a la carta de fábrica',
        on: {
          click: async () => {
            if (
              !confirm(
                '¿Volver a la carta con la que se creó el sitio? Se perderán los precios y platillos que hayas publicado desde entonces.'
              )
            )
              return;
            try {
              const res = await fetch('carta-base.json', { cache: 'no-store' });
              if (!res.ok) throw new Error('no se encontró la carta de fábrica');
              const r = normalizeDoc(await res.json(), { images: estado.slugsBase });
              if (!r.doc.products.length) throw new Error('la carta de fábrica llegó vacía');
              estado.doc = r.doc;
              pintarTodo();
              marcarSucio();
              toast('Carta de fábrica cargada. Falta publicar.');
            } catch (err) {
              aviso('bad', `No se pudo cargar la carta de fábrica: ${enEspanol(err.message)}`);
            }
          }
        }
      })
    ])
  );
}

function descargar() {
  renormalizar();
  const blob = new Blob([JSON.stringify(estado.doc, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: 'carta.json' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Archivo descargado.');
}

async function importar(archivo) {
  if (!archivo) return;
  try {
    const texto = await archivo.text();
    const crudo = JSON.parse(texto);
    const { doc, errors } = normalizeDoc(crudo.doc || crudo, { images: slugsDisponibles() });
    if (!doc.products.length) throw new Error('el archivo no trae ningún platillo');
    if (
      !confirm(
        `El archivo trae ${doc.products.length} platillo${doc.products.length === 1 ? '' : 's'}. ` +
          `Reemplazará los ${estado.doc.products.length} que tienes ahora en el panel. ¿Continuar?`
      )
    ) {
      return;
    }
    estado.doc = doc;
    pintarTodo();
    marcarSucio();
    if (errors.length) aviso('warn', 'El archivo se cargó con ajustes:', errors);
    else toast('Archivo cargado. Revisa y publica.');
  } catch (err) {
    aviso('bad', `No se pudo leer el archivo: ${err.message}`);
  }
}

/* ==================================================================
   publicar
   ================================================================== */

/**
 * Lo que no se puede publicar, dicho antes de tocar nada.
 *
 * El validador del servidor descarta un platillo sin nombre o con un precio
 * imposible, y eso se leía como "publicado" mientras el platillo desaparecía
 * de la carta. Aquí se frena antes, nombrando el problema.
 * @returns {string[]}
 */
function revisar() {
  const problemas = [];
  for (const p of estado.doc.products) {
    const nombre = cleanText(p.name, 60);
    if (!nombre) {
      problemas.push('Hay un platillo sin nombre. Ponle nombre o quítalo de la carta.');
      continue;
    }
    if (nombre === 'Platillo nuevo') {
      problemas.push(`"${nombre}" todavía tiene el nombre de ejemplo. Cámbialo o quítalo.`);
    }
    if (!(Number(p.basePrice) > 0)) {
      problemas.push(`"${nombre}" está en $0. Ponle precio o quítalo de la carta.`);
    }
    if (Number(p.basePrice) > LIMITES.precioMax) {
      problemas.push(`El precio de "${nombre}" es demasiado alto. Revisa si sobra algún número.`);
    }
  }
  if (!estado.doc.products.length) problemas.push('La carta se quedaría sin ningún platillo.');
  if (!estado.doc.categories.length) problemas.push('La carta se quedaría sin categorías.');
  const b = estado.doc.business;
  if (b.whatsapp && !/^\d{8,15}$/.test(b.whatsapp)) {
    problemas.push('El WhatsApp debe tener entre 8 y 15 dígitos, con la clave del país.');
  }
  if (b.mapsUrl && !/^https:\/\//.test(b.mapsUrl)) {
    problemas.push('El enlace del mapa tiene que empezar por https://');
  }
  if (b.schedule && b.schedule.days.length && !(b.schedule.to !== b.schedule.from)) {
    problemas.push('La hora de apertura y la de cierre no pueden ser la misma.');
  }
  return [...new Set(problemas)];
}

async function publicar() {
  limpiarAviso();

  const problemas = revisar();
  if (problemas.length) {
    aviso('bad', 'Antes de publicar hay que arreglar esto:', problemas);
    return;
  }

  /* Se normaliza sobre una copia: si la publicación falla, lo que está en
     pantalla no se toca. Antes, un fallo de red dejaba los cambios ya
     reescritos y el horario borrado sin haber publicado nada. */
  const { doc: propuesta, errores } = (() => {
    const r = normalizeDoc(estado.doc, { images: slugsDisponibles() });
    return { doc: r.doc, errores: r.errors };
  })();

  if (estado.modo !== 'live') {
    estado.doc = propuesta;
    pintarTodo();
    marcarSucio();
    descargar();
    aviso(
      'warn',
      'Este sitio guarda la carta en un archivo. Se descargó carta.json: súbelo a la carpeta del sitio, junto a index.html, y la carta quedará actualizada.',
      errores
    );
    return;
  }

  const boton = $('#publicar');
  boton.disabled = true;
  boton.textContent = 'Publicando…';
  try {
    const r = await pedir('api/publicar', {
      method: 'POST',
      body: JSON.stringify({ doc: propuesta })
    });
    estado.doc = r.doc;
    borrarBorrador();
    pintarTodo();
    marcarSucio(false);
    const avisos = [...errores, ...(r.avisos || [])];
    if (avisos.length) aviso('warn', 'Publicado, con estos ajustes:', avisos);
    else aviso('good', 'Publicado. Los clientes ya ven la carta nueva.');
    toast('Carta publicada');
  } catch (err) {
    if (/Sesión caducada/.test(err.message)) {
      estado.token = '';
      mostrarPuerta();
    }
    aviso('bad', enEspanol(err.message));
  } finally {
    boton.textContent = 'Publicar cambios';
    boton.disabled = !estado.sucio;
  }
}

/* ==================================================================
   acceso y arranque
   ================================================================== */

function mostrarPuerta() {
  $('#gate').hidden = false;
  $('#app').hidden = true;
  $('#bar').hidden = true;
  setTimeout(() => $('#password')?.focus(), 50);
}

function mostrarPanel() {
  $('#gate').hidden = true;
  $('#app').hidden = false;
  $('#bar').hidden = false;
}

function pintarTodo() {
  pintarPlatillos();
  pintarCategorias();
  pintarOpciones();
  pintarNegocio();
  pintarRespaldo();
}

function conectarPestanas() {
  const tabs = $$('.tab');
  tabs.forEach((tab) =>
    tab.addEventListener('click', () => {
      tabs.forEach((t) => {
        const activo = t === tab;
        t.setAttribute('aria-selected', String(activo));
        $(`#${t.dataset.panel}`).hidden = !activo;
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    })
  );
}

async function arrancar() {
  estado.slugsBase = Array.isArray(window.SLUGS_BASE) ? window.SLUGS_BASE : [];
  await detectarModo();

  const pill = $('#modo');
  pill.dataset.mode = estado.modo;
  pill.textContent =
    estado.modo === 'live' ? 'Publica al instante' : 'Se publica con un archivo';

  const crudo = await cargarCarta();
  if (!crudo) {
    aviso('bad', 'No se pudo leer la carta del sitio. Recarga la página.');
    return;
  }
  const { doc } = normalizeDoc(crudo, { images: estado.slugsBase });
  estado.base = JSON.parse(JSON.stringify(doc));
  estado.doc = doc;

  let borrador = null;
  try {
    borrador = JSON.parse(localStorage.getItem(CLAVE_BORRADOR) || 'null');
  } catch {
    borrador = null;
  }

  conectarPestanas();
  pintarTodo();
  marcarSucio(false);

  if (borrador && borrador.updatedAt) {
    /* Se aplica de inmediato. Si sólo se anunciara, la pantalla mostraría la
       carta del servidor —con los platillos que ella había borrado— y el
       primer cambio que hiciera sobrescribiría el borrador sin aviso. */
    const r = normalizeDoc(borrador, { images: slugsDisponibles() });
    if (r.doc.products.length) {
      estado.doc = r.doc;
      pintarTodo();
      marcarSucio();
      aviso('warn', 'Recuperamos los cambios que dejaste sin publicar la vez pasada.');
      $('#aviso').append(
        el('div.row.mt-sm', {}, [
          el('button.btn', {
            type: 'button',
            text: 'Descartarlos y volver a la carta publicada',
            on: {
              click: () => {
                estado.doc = JSON.parse(JSON.stringify(estado.base));
                borrarBorrador();
                pintarTodo();
                marcarSucio(false);
                limpiarAviso();
              }
            }
          })
        ])
      );
    } else {
      borrarBorrador();
    }
  }

  if (estado.modo === 'live') mostrarPuerta();
  else mostrarPanel();

  $('#gate form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const boton = $('#entrar');
    boton.disabled = true;
    try {
      const r = await pedir('api/entrar', {
        method: 'POST',
        body: JSON.stringify({ password: $('#password').value })
      });
      estado.token = r.token;
      $('#password').value = '';
      limpiarAviso();
      mostrarPanel();
    } catch (err) {
      $('#gate-error').textContent = err.message;
      $('#gate-error').hidden = false;
    } finally {
      boton.disabled = false;
    }
  });

  $('#publicar').addEventListener('click', publicar);
  $('#salir').hidden = estado.modo !== 'live';
  $('#salir').addEventListener('click', async () => {
    if (estado.sucio && !confirm('Tienes cambios sin publicar. ¿Salir de todos modos?')) return;
    const token = estado.token;
    estado.token = '';
    mostrarPuerta();
    if (!token) return;
    /* Se avisa al servidor para que el token deje de valer también si alguien
       lo copió: borrarlo de esta pantalla no bastaría. */
    try {
      await fetch('api/entrar', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ accion: 'salir' })
      });
    } catch {
      /* si no se puede avisar, el token caduca solo en unas horas */
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (!estado.sucio) return;
    e.preventDefault();
    e.returnValue = '';
  });

  document.documentElement.dataset.ready = 'true';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', arrancar, { once: true });
} else {
  arrancar();
}
