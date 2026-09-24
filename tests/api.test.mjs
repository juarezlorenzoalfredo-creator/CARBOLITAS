/**
 * Las funciones del servidor, ejecutadas tal cual pero con un almacén en
 * memoria. Cubre lo que decide si el panel es seguro: quién puede publicar,
 * qué se guarda y qué pasa cuando el almacén falla.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/* --- almacén de mentira, con la misma interfaz que Netlify Blobs --- */
function montarAlmacen() {
  const datos = new Map();
  const etags = new Map();
  let sello = 0;
  globalThis.__CARBOLITAS_BLOBS__ = () => ({
    async getWithMetadata(key, opts = {}) {
      if (!datos.has(key)) return null;
      const v = datos.get(key);
      const valor = opts.type === 'json' ? JSON.parse(v.toString('utf8')) : v.toString('utf8');
      return { data: valor, etag: etags.get(key) };
    },
    async get(key, opts = {}) {
      if (!datos.has(key)) return null;
      const v = datos.get(key);
      if (opts.type === 'json') return JSON.parse(v.toString('utf8'));
      if (opts.type === 'arrayBuffer') return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
      return v.toString('utf8');
    },
    async set(key, value) {
      datos.set(key, Buffer.isBuffer(value) ? value : Buffer.from(value));
      etags.set(key, String(++sello));
    },
    async setJSON(key, value, opts = {}) {
      if (opts.onlyIfMatch !== undefined && etags.get(key) !== opts.onlyIfMatch) {
        throw new Error('conflicto');
      }
      if (opts.onlyIfNew && datos.has(key)) throw new Error('ya existe');
      datos.set(key, Buffer.from(JSON.stringify(value)));
      etags.set(key, String(++sello));
    },
    async delete(key) {
      datos.delete(key);
      etags.delete(key);
    }
  });
  return datos;
}

function romperAlmacen() {
  globalThis.__CARBOLITAS_BLOBS__ = () => {
    throw new Error('sin almacén');
  };
}

const post = (url, body, token) =>
  new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });

let n = 0;
async function funciones(password = 'Alitas-al-carbon-2026') {
  if (password === null) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = password;
  n += 1;
  const [entrar, publicar, carta, foto] = await Promise.all([
    import(`../netlify/functions/entrar.mjs?n=${n}`),
    import(`../netlify/functions/publicar.mjs?n=${n}`),
    import(`../netlify/functions/carta.mjs?n=${n}`),
    import(`../netlify/functions/foto.mjs?n=${n}`)
  ]);
  return {
    entrar: entrar.default,
    publicar: publicar.default,
    carta: carta.default,
    foto: foto.default
  };
}

const CARTA = {
  categories: [{ id: 'dogos', name: 'Dogos' }],
  products: [{ id: 'hotdog', categoryId: 'dogos', name: 'Hotdog con tocino', basePrice: 30 }],
  business: { whatsapp: '524471257475' }
};

async function entrarOk(fns) {
  const res = await fns.entrar(post('https://x/api/entrar', { password: 'Alitas-al-carbon-2026' }));
  const data = await res.json();
  assert.equal(res.status, 200);
  return data.token;
}

test('entrar rechaza la contraseña equivocada y acepta la buena', async () => {
  montarAlmacen();
  const fns = await funciones();
  const mal = await fns.entrar(post('https://x/api/entrar', { password: 'nope' }));
  assert.equal(mal.status, 401);
  const bien = await fns.entrar(post('https://x/api/entrar', { password: 'Alitas-al-carbon-2026' }));
  assert.equal(bien.status, 200);
  assert.ok((await bien.json()).token);
});

test('entrar avisa cuando falta configurar la contraseña del sitio', async () => {
  montarAlmacen();
  const fns = await funciones(null);
  const res = await fns.entrar(post('https://x/api/entrar', { password: 'x' }));
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /ADMIN_PASSWORD/);
});

test('entrar se cierra tras demasiados intentos fallidos', async () => {
  montarAlmacen();
  const fns = await funciones();
  let ultimo;
  for (let i = 0; i < 9; i += 1) {
    ultimo = await fns.entrar(post('https://x/api/entrar', { password: 'nope' }));
  }
  assert.equal(ultimo.status, 429);
  /* Y con la contraseña correcta tampoco: el freno es por origen, no por acierto. */
  const bueno = await fns.entrar(post('https://x/api/entrar', { password: 'Alitas-al-carbon-2026' }));
  assert.equal(bueno.status, 429);
});

test('publicar sin token no guarda nada', async () => {
  montarAlmacen();
  const fns = await funciones();
  const res = await fns.publicar(post('https://x/api/publicar', { doc: CARTA }));
  assert.equal(res.status, 401);
});

test('publicar con un token inventado no guarda nada', async () => {
  montarAlmacen();
  const fns = await funciones();
  const res = await fns.publicar(post('https://x/api/publicar', { doc: CARTA }, 'aaa.bbb'));
  assert.equal(res.status, 401);
});

test('publicar con token válido guarda y la carta lo devuelve', async () => {
  montarAlmacen();
  const fns = await funciones();
  const token = await entrarOk(fns);
  const res = await fns.publicar(post('https://x/api/publicar', { doc: CARTA }, token));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);

  const leida = await fns.carta(new Request('https://x/carta.json'));
  const doc = await leida.json();
  assert.equal(doc.products[0].name, 'Hotdog con tocino');
  assert.equal(leida.headers.get('x-carbolitas-panel'), '1');
});

test('la hora de publicación la pone el servidor, no el panel', async () => {
  montarAlmacen();
  const fns = await funciones();
  const token = await entrarOk(fns);
  const res = await fns.publicar(
    post('https://x/api/publicar', { doc: { ...CARTA, updatedAt: '1999-01-01T00:00:00.000Z' } }, token)
  );
  const { updatedAt } = await res.json();
  assert.notEqual(updatedAt, '1999-01-01T00:00:00.000Z');
  assert.ok(Date.now() - new Date(updatedAt).getTime() < 60000);
});

test('no se puede publicar una carta vacía', async () => {
  montarAlmacen();
  const fns = await funciones();
  const token = await entrarOk(fns);
  const res = await fns.publicar(post('https://x/api/publicar', { doc: { products: [] } }, token));
  assert.equal(res.status, 422);
});

test('lo que se guarda pasa por el validador, no tal cual', async () => {
  const datos = montarAlmacen();
  const fns = await funciones();
  const token = await entrarOk(fns);
  await fns.publicar(
    post(
      'https://x/api/publicar',
      {
        doc: {
          ...CARTA,
          products: [
            ...CARTA.products,
            { id: 'malo', categoryId: 'dogos', name: 'Gratis', basePrice: -1 }
          ],
          business: { whatsapp: 'no-es-un-numero', mapsUrl: 'javascript:alert(1)' }
        }
      },
      token
    )
  );
  const guardado = JSON.parse(datos.get('carta.json').toString('utf8'));
  /* El precio negativo se acota a 0 en lugar de borrar el platillo; el panel
     no deja publicar un $0, pero si alguien envía el JSON a mano, lo que se
     guarda sigue siendo una carta con forma válida. */
  assert.equal(guardado.products.length, 2);
  assert.equal(guardado.products[1].basePrice, 0);
  assert.equal(guardado.business.whatsapp, '');
  assert.equal(guardado.business.mapsUrl, '');
});

test('un cuerpo enorme se rechaza antes de procesarlo', async () => {
  montarAlmacen();
  const fns = await funciones();
  const token = await entrarOk(fns);
  const gigante = JSON.stringify({ doc: { relleno: 'x'.repeat(600 * 1024) } });
  const res = await fns.publicar(post('https://x/api/publicar', gigante, token));
  assert.equal(res.status, 400);
});

test('un cuerpo que no es JSON no rompe la función', async () => {
  montarAlmacen();
  const fns = await funciones();
  const token = await entrarOk(fns);
  const res = await fns.publicar(post('https://x/api/publicar', 'no es json', token));
  assert.equal(res.status, 400);
});

test('sin almacén no se publica nada: se cierra, no se finge', async () => {
  const datos = montarAlmacen();
  const fns = await funciones();
  const token = await entrarOk(fns);
  romperAlmacen();
  const res = await fns.publicar(post('https://x/api/publicar', { doc: CARTA }, token));
  /* Se corta ya en la comprobación del token: el secreto de firma vive en el
     almacén, así que sin almacén no se puede validar a nadie. Lo importante es
     que no se guarde nada y que el panel reciba un error, no un "listo". */
  assert.ok(res.status === 401 || res.status === 503, `status ${res.status}`);
  assert.equal(datos.has('carta.json'), false);
});

test('una contraseña demasiado corta no habilita el panel', async () => {
  montarAlmacen();
  const fns = await funciones('corta123');
  const res = await fns.entrar(post('https://x/api/entrar', { password: 'corta123' }));
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /al menos 12/);
});

test('los intentos simultáneos se cuentan todos, no sólo uno', async () => {
  montarAlmacen();
  const fns = await funciones();
  const tandas = await Promise.all(
    Array.from({ length: 20 }, () => fns.entrar(post('https://x/api/entrar', { password: 'nope' })))
  );
  /* Lo que importa no es qué código sale, sino cuántas contraseñas llegaron a
     comprobarse: 401 significa "se evaluó tu intento". Con la cuenta
     condicionada no pueden pasar más que el tope; sin ella pasaban las 20. */
  const evaluados = tandas.filter((r) => r.status === 401).length;
  assert.ok(evaluados <= 8, `se evaluaron ${evaluados} intentos de 20`);
  assert.ok(
    tandas.every((r) => [401, 429, 503].includes(r.status)),
    'ningún intento en paralelo debería tener éxito'
  );
});

test('salir apaga el token, no sólo la pantalla', async () => {
  montarAlmacen();
  const fns = await funciones();
  const token = await entrarOk(fns);
  const antes = await fns.publicar(post('https://x/api/publicar', { doc: CARTA }, token));
  assert.equal(antes.status, 200);

  const salida = await fns.entrar(post('https://x/api/entrar', { accion: 'salir' }, token));
  assert.equal(salida.status, 200);

  const despues = await fns.publicar(post('https://x/api/publicar', { doc: CARTA }, token));
  assert.equal(despues.status, 401);
});

test('salir exige un token válido', async () => {
  montarAlmacen();
  const fns = await funciones();
  const res = await fns.entrar(post('https://x/api/entrar', { accion: 'salir' }));
  assert.equal(res.status, 401);
});

test('un token no sirve para probar contraseñas sin conexión', async () => {
  montarAlmacen();
  const fns = await funciones();
  const token = await entrarOk(fns);
  const { createHmac } = await import('node:crypto');
  const [payload, firma] = token.split('.');
  /* Así se atacaría si el token se firmara con la contraseña: probar
     candidatos hasta que la firma coincida. Con un secreto propio del sitio,
     ni siquiera la contraseña correcta reproduce la firma. */
  const candidatos = ['Alitas-al-carbon-2026', 'otra', '::Alitas-al-carbon-2026::carbolitas'];
  for (const c of candidatos) {
    const intento = createHmac('sha256', c)
      .update(payload)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    assert.notEqual(intento, firma);
  }
});

test('las variantes de una foto tienen tope', async () => {
  montarAlmacen();
  const fns = await funciones();
  const token = await entrarOk(fns);
  const res = await fns.foto(
    post(
      'https://x/api/foto',
      {
        slug: 'muchas',
        variants: Array.from({ length: 12 }, (_, i) => ({
          w: 320 + i,
          h: 240,
          data: webpFalso()
        }))
      },
      token
    )
  );
  const { entry } = await res.json();
  assert.ok(entry.variants.length <= 4, `se guardaron ${entry.variants.length}`);
});

test('los métodos que no son POST se rechazan', async () => {
  montarAlmacen();
  const fns = await funciones();
  for (const fn of [fns.entrar, fns.publicar]) {
    const res = await fn(new Request('https://x/api/x', { method: 'GET' }));
    assert.equal(res.status, 405);
  }
});

/* --- fotos --- */

/** WebP mínimo válido: cabecera RIFF/WEBP y relleno. */
function webpFalso(bytes = 64) {
  const buf = Buffer.alloc(bytes);
  buf.write('RIFF', 0, 'latin1');
  buf.writeUInt32LE(bytes - 8, 4);
  buf.write('WEBP', 8, 'latin1');
  return buf.toString('base64');
}

test('subir una foto exige token', async () => {
  montarAlmacen();
  const fns = await funciones();
  const res = await fns.foto(
    post('https://x/api/foto', { slug: 'x', variants: [{ w: 320, h: 240, data: webpFalso() }] })
  );
  assert.equal(res.status, 401);
});

test('sólo se aceptan archivos que de verdad son WebP', async () => {
  montarAlmacen();
  const fns = await funciones();
  const token = await entrarOk(fns);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0]).toString('base64');
  const res = await fns.foto(
    post('https://x/api/foto', { slug: 'x', variants: [{ w: 320, h: 240, data: png }] }, token)
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /WebP/);
});

test('el nombre de la foto no puede salirse de su carpeta', async () => {
  montarAlmacen();
  const fns = await funciones();
  const token = await entrarOk(fns);
  for (const slug of ['../secreto', 'con/barra', 'MAYUSCULAS', '']) {
    const res = await fns.foto(
      post('https://x/api/foto', { slug, variants: [{ w: 320, h: 240, data: webpFalso() }] }, token)
    );
    assert.equal(res.status, 400, `slug: ${slug}`);
  }
});

test('una foto válida se guarda y se sirve con caché larga', async () => {
  montarAlmacen();
  const fns = await funciones();
  const token = await entrarOk(fns);
  const res = await fns.foto(
    post(
      'https://x/api/foto',
      { slug: 'hotdog-nueva', variants: [{ w: 320, h: 240, data: webpFalso() }] },
      token
    )
  );
  assert.equal(res.status, 200);
  const { entry } = await res.json();
  assert.deepEqual(entry.variants, [{ w: 320, h: 240, src: 'api/foto/hotdog-nueva-320.webp' }]);

  const servida = await fns.foto(new Request('https://x/api/foto/hotdog-nueva-320.webp'));
  assert.equal(servida.status, 200);
  assert.equal(servida.headers.get('content-type'), 'image/webp');
  assert.match(servida.headers.get('cache-control'), /immutable/);
});

test('pedir una foto que no existe da 404, no un error', async () => {
  montarAlmacen();
  const fns = await funciones();
  const res = await fns.foto(new Request('https://x/api/foto/fantasma-320.webp'));
  assert.equal(res.status, 404);
});

test('una foto demasiado pesada no se guarda', async () => {
  montarAlmacen();
  const fns = await funciones();
  const token = await entrarOk(fns);
  const res = await fns.foto(
    post(
      'https://x/api/foto',
      { slug: 'pesada', variants: [{ w: 320, h: 240, data: webpFalso(500 * 1024) }] },
      token
    )
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /pesa demasiado/);
});
