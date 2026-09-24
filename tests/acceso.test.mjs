/**
 * Acceso al panel: contraseña, token, caducidad y revocación.
 *
 * El módulo lee la contraseña de las variables de entorno y el secreto de
 * firma del almacén, así que cada prueba monta un almacén nuevo y vuelve a
 * importar el módulo con una consulta distinta para no reutilizar el ya
 * cargado.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const PASSWORD = 'Alitas-al-carbon-2026';

import { crear as crearAlmacen } from '../server/drivers/memoria.mjs';

function montarAlmacen() {
  const almacen = crearAlmacen();
  globalThis.__CARBOLITAS_STORE__ = almacen;
  return almacen;
}

let n = 0;
async function cargar(password = PASSWORD, { almacen = true } = {}) {
  if (almacen) montarAlmacen();
  if (password === null) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = password;
  delete process.env.ADMIN_SECRET;
  n += 1;
  return import(`../server/auth.mjs?n=${n}`);
}

const con = (valor) => ({ headers: { get: () => valor } });

test('sin contraseña configurada no entra nadie', async () => {
  const auth = await cargar(null);
  assert.equal(auth.passwordConfigurada(), false);
  assert.equal(auth.passwordCorrecta(''), false);
  assert.equal(auth.passwordCorrecta('lo-que-sea'), false);
  assert.equal(await auth.tokenValido('cualquier.cosa'), false);
  assert.equal(await auth.crearToken(), null);
  assert.match(auth.estadoPassword().motivo, /ADMIN_PASSWORD/);
});

test('una contraseña corta se rechaza con una explicación', async () => {
  const auth = await cargar('corta1234');
  assert.equal(auth.passwordConfigurada(), false);
  assert.equal(auth.passwordCorrecta('corta1234'), false);
  assert.match(auth.estadoPassword().motivo, /al menos 12/);
});

test('sólo la contraseña exacta abre', async () => {
  const auth = await cargar();
  assert.equal(auth.passwordCorrecta(PASSWORD), true);
  assert.equal(auth.passwordCorrecta(PASSWORD.toLowerCase()), false);
  assert.equal(auth.passwordCorrecta(PASSWORD.slice(0, -1)), false);
  assert.equal(auth.passwordCorrecta(`${PASSWORD} `), false);
  assert.equal(auth.passwordCorrecta(null), false);
  assert.equal(auth.passwordCorrecta(undefined), false);
  assert.equal(auth.passwordCorrecta({}), false);
});

test('el token que emite el servidor vale', async () => {
  const auth = await cargar();
  const { token, expira } = await auth.crearToken();
  assert.equal(await auth.tokenValido(token), true);
  assert.ok(expira > Date.now());
});

test('un token manipulado no vale', async () => {
  const auth = await cargar();
  const { token } = await auth.crearToken();
  const [payload, firma] = token.split('.');
  assert.equal(await auth.tokenValido(`${payload}.${firma.slice(0, -2)}xy`), false);
  assert.equal(await auth.tokenValido(`${payload}x.${firma}`), false);
  assert.equal(await auth.tokenValido(payload), false);
  assert.equal(await auth.tokenValido(''), false);
  assert.equal(await auth.tokenValido(null), false);
  const falso = Buffer.from(JSON.stringify({ exp: Date.now() + 1e9 })).toString('base64url');
  assert.equal(await auth.tokenValido(`${falso}.${firma}`), false);
});

test('la firma no se calcula con la contraseña', async () => {
  const auth = await cargar();
  const { token } = await auth.crearToken();
  const [payload, firma] = token.split('.');
  const { createHmac } = await import('node:crypto');
  const b64u = (b) =>
    Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  /* Si la clave fuese la contraseña, quien capture un token podría probar
     candidatos sin conexión. Ninguna combinación con la contraseña reproduce
     la firma porque el secreto es aleatorio y vive en el servidor. */
  for (const clave of [PASSWORD, `::${PASSWORD}::carbolitas`, `${PASSWORD}::carbolitas`]) {
    assert.notEqual(b64u(createHmac('sha256', clave).update(payload).digest()), firma);
  }
});

test('cambiar la contraseña invalida los tokens ya emitidos', async () => {
  const almacen = montarAlmacen();
  process.env.ADMIN_PASSWORD = PASSWORD;
  delete process.env.ADMIN_SECRET;
  n += 1;
  const antes = await import(`../server/auth.mjs?n=${n}`);
  const { token } = await antes.crearToken();
  assert.equal(await antes.tokenValido(token), true);

  /* Mismo almacén (mismo secreto de firma): lo único que cambia es la
     contraseña, y aun así el token deja de valer. */
  process.env.ADMIN_PASSWORD = 'Otra-contrasena-larga-9';
  n += 1;
  const despues = await import(`../server/auth.mjs?n=${n}`);
  assert.equal(await despues.tokenValido(token), false);
  /* El secreto de firma no cambió: lo que invalida el pase es la marca de la
     contraseña que lleva dentro. */
  assert.ok((await almacen.leerTexto('acceso/secreto')).length >= 32);
});

test('un token caducado se rechaza', async () => {
  const auth = await cargar();
  const real = Date.now;
  try {
    Date.now = () => real() - 9 * 3600 * 1000;
    const { token } = await auth.crearToken();
    Date.now = real;
    assert.equal(await auth.tokenValido(token), false);
  } finally {
    Date.now = real;
  }
});

test('revocar apaga los tokens ya emitidos', async () => {
  montarAlmacen();
  process.env.ADMIN_PASSWORD = PASSWORD;
  delete process.env.ADMIN_SECRET;
  n += 1;
  const auth = await import(`../server/auth.mjs?n=${n}`);
  const store = await import(`../server/store.mjs`);
  const { token } = await auth.crearToken();
  assert.equal(await auth.tokenValido(token), true);
  await new Promise((r) => setTimeout(r, 5));
  await store.revocarTodo();
  assert.equal(await auth.tokenValido(token), false);
  /* Y uno emitido después de revocar sí vale. */
  await new Promise((r) => setTimeout(r, 5));
  const nuevo = await auth.crearToken();
  assert.equal(await auth.tokenValido(nuevo.token), true);
});

test('sin almacén no se puede emitir ni validar nada', async () => {
  globalThis.__CARBOLITAS_STORE__ = {
    async disponible() {
      return false;
    }
  };
  process.env.ADMIN_PASSWORD = PASSWORD;
  delete process.env.ADMIN_SECRET;
  n += 1;
  const auth = await import(`../server/auth.mjs?n=${n}`);
  assert.equal(await auth.crearToken(), null);
  assert.equal(await auth.tokenValido('a.b'), false);
});

test('el token se lee del encabezado Authorization', async () => {
  const auth = await cargar();
  assert.equal(auth.tokenDe(con('Bearer abc123')), 'abc123');
  assert.equal(auth.tokenDe(con('bearer abc123')), '');
  assert.equal(auth.tokenDe(con('abc123')), '');
  assert.equal(auth.tokenDe(con(null)), '');
  assert.equal(await auth.autorizado(con('Bearer ')), false);
});

test('el mensaje de configuración no dice si la contraseña es corta o falta', async () => {
  /* A un desconocido no se le cuenta que este sitio usa una clave débil: es
     justo el dato que le diría que vale la pena intentar adivinarla. */
  const sinNada = await cargar(null);
  const corta = await cargar('corta1234');
  assert.equal(sinNada.estadoPassword().motivo, corta.estadoPassword().motivo);
  assert.doesNotMatch(corta.estadoPassword().motivo, /corta|demasiado/i);
  assert.match(corta.estadoPassword().motivo, /ADMIN_PASSWORD/);
});
