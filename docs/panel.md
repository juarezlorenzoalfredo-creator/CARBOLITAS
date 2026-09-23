# El panel administrativo

Está en `/admin.html` del propio sitio. Desde ahí se cambian los platillos, los
precios, las salsas, el horario y el WhatsApp sin tocar código.

El panel edita **el mismo documento** que lee la carta (`carta.json`). No hay
dos verdades: lo que se ve en el panel es exactamente lo que se le sirve al
cliente.

---

## Dónde se abre el panel, y con qué llave

El panel puede estar en tres situaciones. Lo dice la etiqueta de arriba y se
comporta distinto en cada una, a propósito.

### 1. En vivo, con contraseña — lo recomendable

El sitio lleva unas funciones de servidor. Pide contraseña, la comprueba **el
servidor** (no el navegador), y al tocar **Publicar cambios** los clientes ven
la carta nueva en cuanto recargan. Sin volver a subir nada.

Requiere que el sitio de Netlify esté conectado a un repositorio —ver abajo—
porque las funciones se instalan durante el despliegue.

### 2. Publicado sin funciones: el panel queda apagado

Si el sitio se subió arrastrando la carpeta, no hay servidor. En esa situación
`admin.html` **no se abre**: muestra una pantalla que explica cómo encenderlo y
nada más. Ni siquiera carga la carta.

Podría ponerle una contraseña, pero sería mentira. En un archivo estático esa
comprobación corre en el navegador de quien entra, y quien entra puede saltarla
mirando el código de la página. Un candado que cualquiera puede abrir no
protege; sólo hace creer que sí. Por eso el panel se apaga en vez de fingir.

La carta pública funciona igual de bien en este modo: lo único apagado es el
panel.

### 3. En tu computadora

Con el proyecto viene `panel-en-tu-computadora.html`. Se abre con **doble
clic** y funciona sin internet: trae la carta dentro. Editas, tocas **Publicar
cambios** y te descarga un `carta.json` que subes a la carpeta del sitio, junto
a `index.html`.

Ese archivo no pide contraseña porque no está en internet: sólo llega a él
quien ya tiene acceso a tu computadora. **No lo subas al sitio**; si lo subes,
detecta que está en internet y se apaga solo.

---

## Encender la publicación en vivo

1. Sube este proyecto a un repositorio de GitHub (la carpeta entera, no sólo
   `dist/`).
2. En Netlify: **Add new site → Import an existing project** y elige ese
   repositorio. Netlify lee `netlify.toml` y ya sabe qué compilar; no hay que
   escribir nada en los campos de build.
3. **Site configuration → Environment variables → Add a variable**:
   - clave: `ADMIN_PASSWORD`
   - valor: la contraseña del panel, **de 12 caracteres o más**.
4. Vuelve a desplegar (**Deploys → Trigger deploy**) para que tome la variable.
5. Abre `tusitio.netlify.app/admin.html` y entra.

Si abres el panel y dice que falta la contraseña, es que el paso 3 o el 4 no se
completó.

### La sesión

Al entrar, la contraseña se cambia por un pase temporal:

- Vive **mientras la pestaña esté abierta**. Cerrar el navegador la cierra.
- Recargar la página **no** te expulsa a media edición.
- Se cierra sola tras **30 minutos sin tocar nada**, y caduca a las 8 horas.
- **Salir** la apaga en el servidor, no sólo en la pantalla: un pase copiado
  deja de servir en ese momento.

Tus cambios sin publicar no se pierden cuando la sesión se cierra: siguen ahí
al volver a entrar.

### Por qué 12 caracteres

Es la única puerta del panel: quien la cruce puede cambiar los precios y, sobre
todo, el número de WhatsApp al que llegan los pedidos. El servidor frena los
intentos por fuerza bruta, pero una contraseña corta se adivina antes de que el
freno sirva de nada. Con menos de 12 caracteres el panel no abre, a propósito.

Usa una que no uses en ningún otro sitio. Tres palabras que no vayan juntas más
un número es suficiente y se recuerda.

---

## El día a día

**Se acabaron las alitas.** En la lista de platillos, el círculo verde a la
derecha de cada uno. Un toque y se pone en gris: el platillo sigue visible en
la carta pero atenuado, con la etiqueta "Agotado", y no se puede pedir. Otro
toque lo repone. Publica y listo.

**Cambió un precio.** Toca el platillo, cambia el número, publica.

**Hoy cerramos antes.** Pestaña *Negocio* → *Aviso del día*. Sale resaltado
arriba de la carta. Para quitarlo, borra el texto y vuelve a publicar.

**Un platillo nuevo.** Al final de cada categoría hay un botón *Agregar*.
Rellena nombre, precio y descripción, elige si lleva salsa, y publica.

**Cambiar el orden.** Las flechas de cada tarjeta suben o bajan el platillo
dentro de su categoría. El primero de la primera categoría es lo primero que ve
el cliente: conviene que sea lo que más quieras vender.

**Fotos.** *Cambiar foto* en cualquier platillo. La foto se recorta a 4:3 y se
reduce **en tu propio teléfono** antes de subirse, así que pesa poco aunque la
tomes con la cámara. Sólo funciona en publicación en vivo.

Nada de lo que edites se ve en la carta hasta que toques **Publicar cambios**.
La barra de abajo siempre dice si queda algo sin publicar.

---

## Respaldo

Pestaña *Respaldo*:

- **Descargar carta.json** — guarda una copia. Hazlo antes de un cambio grande.
- **Cargar un archivo** — vuelve a una copia guardada. Todavía hay que publicar.
- **Restaurar carta original** — deja la carta como se compiló el sitio.

Si cierras el panel con cambios sin publicar, se guardan en el navegador y al
volver te pregunta si los recuperas.

---

## Seguridad

Lo que protege la carta, y por qué está así:

- **La contraseña nunca se guarda en el navegador.** Se cambia por un pase
  temporal que caduca a las 8 horas y que se borra al cerrar la pestaña.
- **Ese pase se firma con un secreto del sitio, no con la contraseña.** Si se
  firmara con la contraseña, quien capturara un pase podría probar contraseñas
  a millones por segundo en su propia computadora.
- **Salir apaga el pase de verdad**, también si alguien lo copió. Úsalo si
  entraste desde un teléfono que no es tuyo.
- **El servidor no se fía del panel.** Todo lo que llega se vuelve a validar
  con el mismo código que usa la compilación: precios imposibles, enlaces que
  no son `https`, fotos que no existen y textos con caracteres invisibles se
  descartan antes de guardar. Si algo se ajustó, el panel te lo dice al
  publicar.
- **Nunca se puede publicar una carta vacía.** El servidor lo rechaza.
- **Los nombres se muestran como texto, nunca como código.** Un platillo
  llamado `<script>…</script>` se lee así, literal, en la carta.
- **Los intentos de contraseña se cuentan** y se bloquean tras ocho fallos en
  quince minutos. Si el conteo no está disponible, no entra nadie.

Si sospechas que alguien más tiene la contraseña: cámbiala en Netlify y vuelve
a desplegar. Todos los pases emitidos dejan de valer al instante.

---

## Probarlo sin desplegar

```
ADMIN_PASSWORD=una-contrasena-larga npm run dev
```

Levanta la carta en `http://127.0.0.1:4321/` y el panel en `/admin.html`, con
las mismas funciones que en producción y los datos en `.dev-data/`.
