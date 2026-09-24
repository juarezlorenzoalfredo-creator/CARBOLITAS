# Subir la carta a Vercel

Pasos completos, de cero a la carta publicada con el panel funcionando.
Tardan unos 20 minutos la primera vez. No hace falta saber programar, pero sí
seguir el orden: el paso 4 es el que suele saltarse y sin él el panel no abre.

---

## Lo que vas a necesitar

- Una cuenta de **GitHub** (gratis) — es donde vive el proyecto.
- Una cuenta de **Vercel** (gratis) — es donde se publica.
- El archivo **`carbolitas-carta.zip`** que viene con esta entrega.
- Una **contraseña para el panel**, de 12 caracteres o más, que no uses en
  ningún otro sitio. Apúntala antes de empezar.

---

## 1. Subir el proyecto a GitHub

1. Entra a <https://github.com> y crea una cuenta si no tienes.
2. Arriba a la derecha, **+** → **New repository**.
3. Nombre: `carbolitas`. Elige **Private**. Crea el repositorio.
4. En la pantalla que aparece, busca **uploading an existing file**.
5. Descomprime `carbolitas-carta.zip` en tu computadora y **arrastra todo el
   contenido** de la carpeta a esa página. Todo: las carpetas `src`, `server`,
   `api`, `dist`, `tools`, `docs`, y los archivos sueltos `package.json`,
   `vercel.json`, `netlify.toml`, `README.md`.
6. Abajo, **Commit changes**.

> No subas `panel-en-tu-computadora.html`. Ese archivo se queda en tu
> computadora: es el panel que se abre con doble clic.

---

## 2. Conectar Vercel con el repositorio

1. Entra a <https://vercel.com> y crea la cuenta **con GitHub** (el botón
   "Continue with GitHub"). Así Vercel ya ve tus repositorios.
2. **Add New…** → **Project**.
3. Busca `carbolitas` en la lista y pulsa **Import**.
4. Vercel lee el archivo `vercel.json` del proyecto y ya sabe qué hacer: no
   cambies nada en "Framework Preset", "Build Command" ni "Output Directory".
5. Pulsa **Deploy** y espera. Al terminar te da una dirección tipo
   `carbolitas-algo.vercel.app`.

En este punto **la carta ya funciona**. El panel todavía no: faltan los dos
pasos siguientes.

---

## 3. Crear el almacén donde se guarda la carta

El panel necesita un sitio donde guardar lo que publiques. Vercel lo incluye.

1. En tu proyecto, pestaña **Storage**.
2. **Create Database** → elige **Blob** → **Continue**.
3. Nombre: `carbolitas-carta`. **Create**.
4. Asegúrate de que queda **conectado a este proyecto** (Vercel lo hace solo;
   si te pregunta, di que sí).

Con esto Vercel añade sola la variable `BLOB_READ_WRITE_TOKEN`. No tienes que
copiarla ni verla.

---

## 4. Poner la contraseña del panel

1. En tu proyecto, **Settings** → **Environment Variables**.
2. **Key**: `ADMIN_PASSWORD`
3. **Value**: tu contraseña, de **12 caracteres o más**.
4. Deja marcados los tres entornos (Production, Preview, Development).
5. **Save**.

> Si pones menos de 12 caracteres, el panel no abre. Es a propósito: es la
> única puerta y una contraseña corta se adivina.

---

## 5. Volver a desplegar para que tome los cambios

Los dos pasos anteriores no se aplican al sitio que ya está publicado.

1. Pestaña **Deployments**.
2. En el despliegue de arriba, el menú **···** → **Redeploy** → **Redeploy**.

---

## 6. Comprobar que quedó bien

Abre estas tres direcciones, cambiando `TUSITIO` por la tuya:

| Dirección | Lo que tiene que pasar |
| --- | --- |
| `TUSITIO.vercel.app` | Se ve la carta con las fotos |
| `TUSITIO.vercel.app/carta.json` | Aparece texto con llaves y comillas (es normal) |
| `TUSITIO.vercel.app/admin.html` | Te **pide la contraseña** |

Entra al panel, cambia un precio cualquiera, toca **Publicar cambios**, y abre
la carta en otra pestaña. Si el precio cambió, está todo funcionando. Vuelve a
dejarlo como estaba.

**Prueba también una foto**: abre un platillo, *Cambiar foto*, elige una del
teléfono y publica. Es la única parte que depende del almacén de Vercel; si
algo fallara sería aquí, y te lo diría con un mensaje en rojo.

---

## 7. La dirección definitiva

`carbolitas-algo.vercel.app` no se dicta bien por teléfono.

- **Gratis:** Settings → **Domains** → edita el subdominio a algo como
  `carbolitas.vercel.app` (si está libre).
- **Con dominio propio:** si compras `carbolitas.mx` o similar, se añade en esa
  misma pantalla y Vercel te dice qué configurar donde lo compraste.

Haz esto **antes** de imprimir cualquier QR.

---

## Si algo no sale

| Lo que ves | Qué pasa |
| --- | --- |
| El panel dice **"El panel está apagado en este sitio"** | Las funciones no se desplegaron. Revisa que `vercel.json` y la carpeta `api/` estén en el repositorio, y vuelve a desplegar |
| **"El panel no está disponible…"** al entrar | Falta `ADMIN_PASSWORD`, tiene menos de 12 caracteres, o no volviste a desplegar (pasos 4 y 5) |
| **"No se pudo abrir la sesión: el almacén no responde"** | Falta el paso 3, o el almacén no quedó conectado a este proyecto |
| **"Demasiados intentos"** | Ocho contraseñas mal en quince minutos. Espera y vuelve |
| La carta se ve pero sin fotos | La carpeta `dist/img` no llegó al repositorio |
| Publicas y los clientes no ven el cambio | Lo veríamos raro: la carta la sirve la función, no un archivo. Revisa en Deployments que el último despliegue diga "Ready" |

---

## Qué diferencia hay con Netlify

Ninguna para ti: el panel, la carta y el pedido por WhatsApp son idénticos. El
mismo código corre en las dos; sólo cambia dónde se guardan los datos
(Vercel Blob en vez de Netlify Blobs) y cómo se declaran las rutas
(`vercel.json` en vez de `netlify.toml`). Puedes tener el sitio en una, en la
otra, o mover de una a otra sin tocar nada.

Un detalle técnico que conviene no deshacer: en Vercel el build **no** genera
el archivo `dist/carta.json`. Vercel busca archivos antes que funciones, así
que si ese archivo existiera taparía a la función y publicar desde el panel no
cambiaría nada para los clientes —tú verías "Publicado" y ellos seguirían con
la carta vieja—. De eso se encarga el `buildCommand` de `vercel.json`.

---

## Probarlo en tu computadora antes de subir

Si tienes Node instalado:

```bash
npm install
ADMIN_PASSWORD=una-contrasena-larga npm run dev:vercel
```

Levanta la carta en `http://127.0.0.1:4321/` con las mismas rutas y cabeceras
que usará Vercel —las lee del `vercel.json` de verdad—, así que sirve para
comprobar el despliegue sin desplegarlo.
