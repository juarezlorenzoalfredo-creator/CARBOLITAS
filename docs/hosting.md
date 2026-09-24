# Publicar la carta

`dist/` es todo lo que hay que subir, **la carpeta entera**: `index.html`, la
carpeta `img/` con las 33 fotografías, y los tres archivos de configuración
que genera el build (`_headers`, `netlify.toml`, `robots.txt`).

> El error más común al publicar es subir únicamente `index.html`. Todas las
> rutas de imagen son relativas (`img/portada-960.webp`), así que sin la
> carpeta `img/` al lado del HTML la carta se ve sin una sola fotografía.

Funciona en cualquier hosting estático y también desde una memoria USB.

## Antes de publicar

1. El WhatsApp ya está puesto: `whatsapp: '524471257475'`. Si cambia el número,
   se edita ahí (formato internacional, sólo dígitos).
2. Dirección y horario ya están puestos: miércoles a lunes de 6:30 p.m. a
   10:00 p.m. (martes cerrado). Si cambian, se editan dos campos de
   `src/config.js`:
   - `schedule` — lo que usa la carta para decir si está abierta ahora.
     `days` va de 0 (domingo) a 6 (sábado); `from`/`to` en minutos desde
     medianoche (18*60+30 = 6:30 p.m.).
   - `hours` — cómo se lee el horario en la sección "El local".
   Los dos deben decir lo mismo.
3. `npm run build`.

## Netlify

Hay dos caminos, y la diferencia es si quieres el panel administrativo en vivo.

**Con panel (recomendado).** Se conecta el repositorio: *Add new site → Import
an existing project*. Netlify lee el `netlify.toml` de la raíz, compila con
`npm run build`, publica `dist/` e instala las funciones de `netlify/`. Falta
una cosa más: la variable `ADMIN_PASSWORD`. Los pasos completos están en
[panel.md](panel.md).

**Sin panel.** Arrastrar `dist/` (o el zip de entrega) a
<https://app.netlify.com/drop>. El build ya deja dentro lo que Netlify
necesita. La carta funciona igual; lo que no hay es publicación en vivo: los
cambios del panel se descargan como `carta.json` y se vuelven a subir a mano.

Dos ajustes que sí se hacen en el panel:

- **Sitio privado.** Si al abrir la URL aparece *"This site is private — sign
  in with an invited Netlify account"*, el sitio está protegido y ningún
  cliente puede verlo. Se quita en *Site configuration → Access & security →
  Visitor access*.
- **Nombre del sitio.** *Site configuration → Site details → Change site name*
  convierte `jade-tanuki-492d6d.netlify.app` en algo como
  `carbolitas.netlify.app`. Conviene hacerlo **antes** de imprimir el QR.

### Por qué `skip_processing = true`

La CSP del documento no usa `'unsafe-inline'`: autoriza el `<script>` y el
`<style>` por su hash SHA-256. Si Netlify minifica o reescribe el HTML —aunque
sea un espacio— el hash deja de coincidir y el navegador bloquea el script y
los estilos completos: página en blanco y errores de CSP en la consola.
`dist/netlify.toml` desactiva ese post-procesado.

## Cabeceras

`dist/_headers` ya declara lo que no puede ir en el `<meta>` del documento:

```
Content-Security-Policy: frame-ancestors 'none'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

Más las de caché: `img/` un año e inmutable (los nombres llevan el ancho, así
que un cambio de foto cambia el archivo), `index.html` siempre revalidado para
que un cambio de precio se vea en el siguiente refresco.

En un hosting que no lea `_headers` (Apache, nginx, cPanel) hay que declarar
esas mismas cabeceras en la configuración del servidor.

Activa compresión (gzip o brotli): el HTML baja de ~97 KB a ~22 KB.

## Si algo no se ve

| Síntoma | Causa casi siempre |
| --- | --- |
| Ninguna foto carga | Se subió sólo `index.html`, sin la carpeta `img/` |
| Pide iniciar sesión | Protección de visitantes activada en Netlify |
| Página en blanco, errores de CSP | El hosting reescribió el HTML inline |
| Una sola foto falta | Ese archivo no llegó: la carta lo sustituye por la placa de parrilla y sigue funcionando |
| El panel dice "Panel apagado" | El sitio se subió sin funciones: es un despliegue por arrastre, no desde el repositorio. Sin servidor no hay contraseña que comprobar, así que el panel no se abre |
| El panel pide `ADMIN_PASSWORD` | Falta la variable de entorno, o el sitio no se ha vuelto a desplegar desde que se añadió |

El build falla a propósito si el documento referencia una imagen que no existe
en `dist/img/`, así que una ruta rota no llega a producción.

## El QR

Apunta el QR a la URL de la carta. Conviene imprimirlo con la leyenda
"Escanea y pide" y probarlo con el teléfono más viejo del local antes de
mandarlo a imprimir.
