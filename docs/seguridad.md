# Auditoría de seguridad

Tres revisiones adversarias sobre el proyecto: una del servidor original, otra
del acceso al panel, y una tercera del sistema completo tras prepararlo para
Vercel. Este documento resume qué se buscó, qué se encontró y qué quedó
arreglado.

Lo que se protege, por orden de importancia:

1. Que nadie que no seas tú cambie la carta, los precios y —sobre todo— **el
   número de WhatsApp al que llegan los pedidos**. Cambiarlo es la forma más
   rentable de atacar un negocio como este: los pedidos se irían a otro
   teléfono sin que nadie lo notara.
2. Que el texto de la carta no pueda ejecutar código en el teléfono de un
   cliente.
3. Que nadie pueda inflar la factura del hosting con peticiones.
4. Que no se filtren la contraseña ni el pase de sesión.

---

## Lo que se encontró y se corrigió

### Graves

**El freno contra adivinar la contraseña no frenaba nada.** Contaba los
intentos leyendo un número, sumándole uno y volviéndolo a escribir. Sesenta
peticiones a la vez leían el mismo número y lo escribían sesenta veces: el
contador se quedaba en uno. Se comprobó: 60 intentos en medio segundo, ninguno
bloqueado. Ahora cada intento deja su propia marca con nombre único y se
cuentan las marcas; veinte peticiones simultáneas cuentan veinte.

**El pase de sesión servía para adivinar la contraseña sin conexión.** Se
firmaba usando la contraseña como clave, así que quien capturara un pase
—una extensión del navegador, una pantalla compartida— podía probar millones
de contraseñas por segundo en su propia computadora hasta que la firma
coincidiera. Se reprodujo con una lista de cinco candidatas. Ahora se firma con
un secreto aleatorio que sólo conoce el servidor.

**El freno se podía esquivar con una cabecera.** Contaba los intentos por
dirección de origen, pero leía una cabecera que el propio atacante escribe:
cambiándola en cada intento, cada uno caía en un cubo distinto y ninguno
llegaba al límite. Peor: los intentos reales, que no llevan esa cabecera,
compartían un solo cubo, así que nueve peticiones basura te dejaban fuera de tu
propio panel quince minutos. Se verificó en el servidor con forma de Vercel: 30
intentos con la cabecera rotando, 30 evaluados, cero bloqueados. Ahora sólo se
acepta la cabecera que pone la plataforma —las dos la sobrescriben antes de
entregar la petición, precisamente contra esto— y si no viene, no se atiende.

**Un error al escribir apagaba el freno en silencio.** Si el almacén dejaba de
admitir escrituras (cuota llena, credencial caducada) el contador se quedaba en
cero y el sistema respondía que todo iba bien. Se reprodujo: 50 contraseñas mal
sin un solo bloqueo, y la 51 correcta entraba. Ahora, si no se puede contar, no
se comprueba ninguna contraseña.

### Medias

**Un fallo de lectura resucitaba los pases apagados.** "Salir" apaga todos los
pases escribiendo una marca de tiempo. Si esa marca no se podía leer, el código
lo interpretaba como "nunca se ha revocado" y el pase volvía a valer — justo el
caso del teléfono prestado para el que existe el botón. Ahora, si no se puede
leer, el pase no vale.

**Un `ADMIN_SECRET` corto debilitaba la firma.** La variable opcional se
aceptaba con cualquier longitud; con dos caracteres, un pase bastaba para sacar
la clave y emitir pases falsos. Ahora se exige un mínimo y, si no lo cumple, se
ignora.

**Un platillo podía congelar la carta de todos los clientes.** Ciertos nombres
de grupo de opciones (`constructor`, `toString`) pasaban la validación y luego
rompían el catálogo en el navegador. El fallo se tragaba en silencio: los
clientes se quedaban con la carta anterior para siempre y tú no veías nada
raro. Corregido en el validador.

**En Vercel, la caché podía servir datos viejos de acceso.** Las lecturas del
almacén pasan por la red de distribución y las escrituras se anuncian con 30
días de caché. Tras tocar "Salir", una lectura cacheada habría devuelto el
estado anterior. Ahora todo lo que decide accesos se lee y escribe sin caché.

**Las marcas de intentos no se limpiaban.** Cada intento fallido dejaba un
archivo que nadie borraba: dos peticiones por segundo dejaban unos cinco
millones al mes, todos facturados. Ahora caducan y hay un tope por origen.

### Menores

- El cuerpo de la petición de login se leía entero antes de aplicar el límite;
  ahora se frena primero.
- El tamaño máximo del contenido se medía en caracteres y no en bytes, así que
  un texto con acentos colaba el doble de lo permitido.
- El fragmento `artifact.html` se publicaba dentro del sitio sin la política de
  seguridad que lleva el documento completo; ahora se genera fuera.
- El mensaje de configuración le decía a un desconocido si la contraseña del
  sitio era demasiado corta — justo el dato que le diría que vale la pena
  intentar adivinarla.
- Textos que hablaban de Netlify en un sitio que puede estar en Vercel.

---

## Lo que se revisó y estaba bien

**Nada muta sin pase.** Publicar y subir fotos exigen un pase válido; se
comprobó sin pase, con un pase inventado, con uno manipulado, con uno caducado
y con uno revocado. Sin contraseña configurada, el panel se cierra entero.

**No se puede salir de la carpeta de fotos.** Se probaron `../`, `..%2f`,
rutas con `%2e%2e`, nombres con barra, y la variante por parámetro que usa
Vercel. Todos rechazados, ninguno llegó al almacén.

**No hay forma de colar código en la carta.** Todo el texto entra al documento
como texto, nunca como HTML. Se publicó una carta hostil a propósito —un
platillo llamado `<script>alert(1)</script>`, un enlace de mapa con comillas
para escaparse del atributo, un aviso con `</script>`— y se abrió la carta en
un navegador real: cero ventanas emergentes, cero errores. Los enlaces sólo
admiten `https://`, el WhatsApp sólo dígitos y las fotos sólo rutas del propio
sitio.

**La política de seguridad del navegador no tiene huecos.** Las dos páginas
declaran `default-src 'none'` y autorizan su código por huella criptográfica,
sin `unsafe-inline`. Si alguien lograra inyectar algo, el navegador no lo
ejecutaría.

**El panel no se abre donde no puede protegerse.** Publicado sin servidor, no
muestra el editor: ni siquiera carga la carta. No hay forma de confundirlo para
que se abra en un sitio público.

**La contraseña nunca se guarda ni viaja de más.** Se cambia por un pase
temporal que vive en la pestaña, caduca a las 8 horas, se cierra a los 30
minutos sin uso y se apaga en el servidor al salir. La comparación de la
contraseña es de tiempo constante: no filtra ni su longitud.

**No hay CSRF.** El pase viaja en una cabecera, no en una cookie, y ningún
endpoint permite peticiones de otros sitios.

**Nada en Vercel queda público por accidente.** El secreto, el contador, la
carta y las fotos se guardan en modo privado; las fotos se sirven por nuestra
propia función, nunca por una URL del almacén.

**Las cabeceras de seguridad son las mismas en las dos plataformas.** Se
comprobaron una por una contra un servidor que lee el `vercel.json` real.

---

## Lo que sigue dependiendo de ti

- **La contraseña.** Es la única puerta. Doce caracteres o más, que no uses en
  ningún otro sitio. Tres palabras que no vayan juntas más un número.
- **Con quién la compartes.** No hay usuarios separados: quien la tenga puede
  cambiarlo todo.
- **Salir si entras desde un teléfono prestado.** Apaga el pase de verdad, no
  sólo la pantalla.
- **Cambiarla si sospechas.** Cámbiala en el panel del hosting y vuelve a
  desplegar: todos los pases dejan de valer al instante.

---

## Lo que no se pudo probar desde aquí

Las funciones se ejecutaron contra almacenes locales que imitan el contrato de
Netlify Blobs y Vercel Blob, y contra servidores que leen la configuración real
de las dos plataformas. Lo que **no** se pudo tocar es el servicio de
almacenamiento de verdad. La primera vez que despliegues conviene comprobar a
mano tres cosas, que son las que dependen de él:

1. Entrar al panel (usa el secreto de firma).
2. Publicar un cambio y verlo en la carta (usa la lectura y la escritura).
3. Subir una foto (usa el almacenamiento binario).

Si las tres funcionan, el resto ya está verificado.

---

## Cómo volver a comprobarlo

```bash
npm test     # 94 pruebas: validación, acceso, y lo que debe fallar cerrado
npm run qa   # 165 comprobaciones en navegador, en 12 tamaños de pantalla
```

Entre ellas: publicar un nombre con HTML y confirmar que se muestra como texto;
que un pase copiado deja de servir tras "Salir"; que el panel sin servidor no
pinta ni un platillo; y que un fallo del almacén cierra el acceso en vez de
abrirlo.
