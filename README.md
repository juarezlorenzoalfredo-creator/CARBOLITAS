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
netlify/      funciones del servidor (publicar la carta, fotos, acceso)
tools/        build, pipeline de imagen, QA, servidor de desarrollo
tests/        pruebas unitarias
docs/         arquitectura, sistema de diseño, publicación, panel
dist/         lo que se sube al hosting (lo genera el build)
```

## Comandos

```bash
npm run build     # genera dist/
npm test          # 86 pruebas unitarias
npm run qa        # 141 comprobaciones en navegador (Playwright)
npm run images    # regenera las fotos desde assets/raw (requiere Pillow)

ADMIN_PASSWORD=una-contrasena-larga npm run dev
                  # carta en :4321, panel en :4321/admin.html,
                  # con las funciones reales y datos en .dev-data/
```

## Publicar

- **Con panel en vivo:** conecta este repositorio a Netlify y añade la
  variable `ADMIN_PASSWORD`. Pasos completos en [docs/panel.md](docs/panel.md).
- **Sin panel:** arrastra `dist/` a <https://app.netlify.com/drop>.

Detalles y diagnóstico de problemas en [docs/hosting.md](docs/hosting.md).

## Reglas del proyecto

- **No se inventan datos del negocio.** Precios, productos, dirección y horario
  salen de la carta impresa y de lo que confirmó CARBOLITAS. Lo que no esté
  confirmado no se muestra.
- **El logotipo original no se modifica.** El pipeline sólo lo recorta y le
  pone fondo transparente; el arte no se toca.
- **Nada de secretos en el navegador.** La contraseña del panel vive en una
  variable de entorno del sitio.
