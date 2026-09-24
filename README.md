# CARBOLITAS · carta digital

Carta interactiva para pedir por WhatsApp, con panel administrativo para
cambiar precios, platillos y horarios sin tocar código.

Sin framework y sin dependencias en el navegador: el resultado es un único
documento HTML con todo dentro.

## Qué hay aquí

```
src/          código de la carta y del panel
  config.js       datos del negocio (valores por defecto)
  data/menu.json  la carta impresa, transcrita
  lib/            catálogo, precios, pedido, horario, validador del documento
  ui/             render, ficha de platillo, panel de pedido
  admin/          el panel administrativo
server/       el servidor: acceso, publicar, fotos, almacén
  drivers/        Netlify Blobs, Vercel Blob, y uno local para pruebas
netlify/      envoltorios de Netlify (la lógica está en server/)
api/          envoltorios de Vercel (la misma lógica)
tools/        build, pipeline de imagen, QA, servidor de desarrollo
tests/        pruebas unitarias
docs/         arquitectura, sistema de diseño, publicación, panel
dist/         lo que se sube al hosting (lo genera el build)
panel-en-tu-computadora.html   copia del panel para usar sin internet
                               (la genera el build; NO se sube al sitio)
```

## Comandos

```bash
npm run build     # genera dist/
npm test          # 94 pruebas unitarias
npm run qa        # 165 comprobaciones en navegador (Playwright)
npm run images    # regenera las fotos desde assets/raw (requiere Pillow)

ADMIN_PASSWORD=una-contrasena-larga npm run dev
                  # carta en :4321, panel en :4321/admin.html,
                  # con las funciones reales y datos en .dev-data/

ADMIN_PASSWORD=una-contrasena-larga npm run dev:vercel
                  # lo mismo pero con las rutas y cabeceras de vercel.json,
                  # para comprobar ese despliegue sin desplegarlo
```

## Publicar

El mismo código corre en las dos plataformas; sólo cambia dónde se guardan los
datos y cómo se declaran las rutas.

- **Vercel:** [docs/vercel.md](docs/vercel.md) — paso a paso, de cero.
- **Netlify:** [docs/panel.md](docs/panel.md) — conectar el repositorio y
  añadir `ADMIN_PASSWORD`.
- **Sin panel, en cualquier hosting estático:** sube `dist/`. `admin.html` se
  queda apagado a propósito —sin servidor no hay contraseña que comprobar— y la
  carta se edita con `panel-en-tu-computadora.html`.

Detalles y diagnóstico en [docs/hosting.md](docs/hosting.md).
Revisión de seguridad en [docs/seguridad.md](docs/seguridad.md).

## Reglas del proyecto

- **No se inventan datos del negocio.** Precios, productos, dirección y horario
  salen de la carta impresa y de lo que confirmó CARBOLITAS. Lo que no esté
  confirmado no se muestra.
- **El logotipo original no se modifica.** El pipeline sólo lo recorta y le
  pone fondo transparente; el arte no se toca.
- **Nada de secretos en el navegador.** La contraseña del panel vive en una
  variable de entorno del sitio, y el pase de sesión se firma con un secreto
  del servidor.
- **Ningún candado de mentira.** Donde no se puede comprobar una contraseña de
  verdad, el panel se apaga en lugar de aparentar que protege algo.
