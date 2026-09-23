# El panel administrativo

Está en `/admin.html` del propio sitio. Desde ahí se cambian los platillos, los
precios, las salsas, el horario y el WhatsApp sin tocar código.

El panel edita **el mismo documento** que lee la carta (`carta.json`). No hay
dos verdades: lo que se ve en el panel es exactamente lo que se le sirve al
cliente.

---

## Dos formas de publicar

El panel detecta solo en cuál está y lo dice en la etiqueta de arriba.

### Publicación en vivo (lo recomendable)

El sitio lleva unas funciones de servidor que guardan la carta. Entras con
contraseña, tocas **Publicar cambios** y los clientes ven la carta nueva en
cuanto recargan. No hay que volver a subir nada.

Requiere que el sitio de Netlify esté conectado a un repositorio —ver más
abajo— porque las funciones necesitan instalarse durante el despliegue.

### Modo local

Si el sitio se subió arrastrando la carpeta, no hay servidor que guarde nada.
El panel sigue sirviendo para editar: al tocar **Publicar cambios** descarga un
`carta.json` que subes a la carpeta del sitio, junto a `index.html`. La carta
lo lee al abrirse.

En este modo el panel no pide contraseña —no hay con qué comprobarla— y no
permite subir fotos nuevas. Si no lo vas a usar, borra `admin.html` de la
carpeta antes de subirla.

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

- **La contraseña nunca viaja ni se guarda en el navegador.** Se cambia por un
  pase temporal que caduca a las 8 horas.
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
