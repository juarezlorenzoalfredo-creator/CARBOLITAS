# CARBOLITAS · sistema visual

Dirección aprobada por el cliente: **noche + brasa**. Fondo carbón, acento
naranja, serif de rótulo para la marca y fotografía de comida a sangre. El
pedido se arma en la carta y se manda por WhatsApp.

## Color

| token | valor | uso |
|---|---|---|
| `--noche` | `#0d0c0b` | fondo |
| `--carbon` | `#161412` | tarjetas y paneles |
| `--carbon-2` | `#1e1a17` | pies de panel, fichas de opción |
| `--carbon-3` | `#272220` | botones sutiles, marcador de foto |
| `--linea` | `rgba(247,241,230,.12)` | bordes |
| `--crema` | `#f7f1e6` | texto principal |
| `--crema-2` | `66%` | texto secundario |
| `--crema-3` | `42%` | etiquetas y notas |
| `--brasa` | `#f2762b` | acento: precios, píldora activa, CTA |
| `--brasa-2` | `#ff9147` | hover |
| `--ambar` | `#ffb648` | inicial de la placa de parrilla |
| `--verde-wa` | `#25d366` | botón de enviar por WhatsApp |

## Tipografía

- Display: **Playfair Display** — "CARBOLITAS" en versalitas y el reclamo
  *Sabor que antoja* en cursiva. Respaldo: Georgia.
- Texto y UI: **Archivo**.
- Cifras con `tabular-nums`: los precios alinean.
- La marca de portada es SVG con `textLength`: ocupa el ancho exacto con
  cualquier tipografía, incluso si la remota no carga.

## Piezas

- **Barra superior**: menú, logotipo centrado, carrito con contador.
- **Portada**: fotografía a sangre con degradado, logotipo, marca, filete
  "Sabor al carbón", reclamo en cursiva y el segmentado Comer aquí / Para
  llevar. En pantalla ancha la foto pasa a la derecha con recorte propio 3:4.
- **Píldoras de categoría** pegajosas bajo la barra.
- **Tarjetas** con foto 4:3, nombre, unidad y precio en brasa. En móvil el
  plato de la casa ocupa el ancho; en pantalla ancha todas pesan igual y sólo
  la que va sola en su categoría se despliega horizontal.
- **Placa de parrilla** para los platos sin fotografía: franjas al carbón e
  inicial en ámbar. No hay huecos vacíos.
- **Panel de salsas** con el color de cada una y su nivel de picor.
- **Barra de WhatsApp** naranja con el número; manda el pedido si hay algo en
  la carta, y abre una conversación normal si no.
- **Tu pedido**: hoja inferior en móvil, columna fija a la derecha en
  escritorio. Envía por WhatsApp en verde.

## Reglas

- La comida manda: foto grande, texto corto, precio visible sin abrir nada.
- Objetivos táctiles ≥ 44 px; foco visible en brasa.
- Animaciones de 140–240 ms sobre `transform`/`opacity`; ninguna función
  depende de ellas (`prefers-reduced-motion` respetado).
- Móvil primero (390 × 844). El escritorio no es la versión estirada: la
  portada se parte en dos y el pedido vive fijo a un costado.
