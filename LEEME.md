# XOXO Tecno · Tienda (Node)

La tienda completa en Node.js: cuatro diseños (**A · Red social**, **B · Minimalista**, **C1 · Historia**, animada, y
**C2 · Profesional**, clásica y blanca) con prueba A/B/C. Cada diseño tiene **4 vistas** con un menú arriba: el inicio con
todo y una **home propia para cada categoría** (ventilación, creación de contenido y audio). El panel **/admin**,
las estadísticas, el reparto de WhatsApp entre sucursales, el **pago online con Mercado Pago** (principal) y GO cuotas,
la **calculadora de envíos** (Andreani y Correo Argentino), el **descuento flash** y los **correos** de la tienda.
Necesita Node 20 o más nuevo. La única dependencia es el SDK de Anthropic (`npm ci`), que usa el chat del panel para que Claude conteste solo.

## Arrancarla

```bash
cp .env.example .env   # y completalo
node servidor.js
```

La primera vez crea la carpeta de datos con el contenido de fábrica (`semilla/sitio.inicial.json`) y el usuario del
panel: `admin`, con una contraseña al azar en `datos/config.json` (en `"clave"`). Al entrar por primera vez se cifra y
desaparece de ese archivo. ¿Te la olvidaste? Escribí una nueva en `"clave"` (12 caracteres o más) y entrá con esa.

| Dirección | Qué es |
|---|---|
| `/` | Entrada: manda a cada visitante a uno de los tres diseños |
| `/anuncio/` | Lo mismo, para los anuncios (queda registrado como origen "anuncio"; `?src=instagram` separa la red) |
| `/anuncio/audio/` (y `ventilacion`, `contenido`) | Anuncio de una categoría: entra directo a esa categoría, en su diseño |
| `/red-social/`, `/minimalista/`, `/historia/` y `/profesional/` | Cada diseño (con `?ver` se ve aunque esté apagado) |
| `/profesional/audio/` (en los 4 diseños) | La home de una categoría (`shared/secciones.js`): portada, beneficios, productos, guía, cómo comprar, envíos, garantía y preguntas |
| `/admin/` | Panel: estadísticas, pedidos, anuncio y sucursales, productos, textos, registro, copias y cuenta |

## Pago online

Las claves van en `.env` (ver `.env.example`): `MP_ACCESS_TOKEN` para Mercado Pago y `GOCUOTAS_EMAIL` /
`GOCUOTAS_PASSWORD` para GO cuotas. `BASE_URL` tiene que ser la dirección pública con https, para que las pasarelas
avisen los pagos. En el VPS se cargan con `ssh -t xoxo-vps xoxo-claves`, que además las prueba y explica cómo
probar la pasarela sin cobrar (ver [deploy/LEEME.md](deploy/LEEME.md)).

- Con al menos un medio activo, las páginas muestran **Comprar ahora** y el checkout. Sin ninguno, la tienda funciona
  solo con WhatsApp.
- `PAGOS_DEMO=true` muestra un pago simulado en los medios sin clave, para probar el recorrido sin cobrar.
- El precio sale del contenido de la tienda, nunca del navegador. Un pago se da por aprobado solo después de
  consultarlo en la API de la pasarela.
- **Mercado Pago es el medio principal**: va primero y elegido, con hasta 12 cuotas para todo. GO cuotas queda como
  segunda opción (9 cuotas con débito en celulares). Las cuotas reales y su interés se configuran en cada pasarela.
- **Envío**: en el checkout se elige retiro gratis en sucursal o Andreani / Correo Argentino (a domicilio o a sucursal).
  El costo sale de la tabla de /admin → Tienda y textos → Envíos (por zona y peso) y lo calcula el servidor; en
  Mercado Pago va como un ítem aparte. Son precios estimados hasta tener contrato con cada empresa.
- **Descuento flash**: cada visitante tiene una hora con el cupón `xoxo-<mes>` (xoxo-noviembre). Arriba de cada
  precio se ve el precio de lista tachado; se cobra siempre el precio de la página y el cupón queda en el pedido.
- **Correos**: al aprobarse un pago, el cliente recibe el detalle y la tienda un aviso de venta (ver
  [deploy/CORREO.md](deploy/CORREO.md)).
- Los pedidos se ven en **/admin → Pedidos**, con el WhatsApp del comprador para coordinar la entrega.

## Sucursales y WhatsApp

Todos los botones de WhatsApp pasan por `/api/whatsapp`, que elige la sucursal: cada persona nueva va a la que hoy
recibió menos personas. La misma persona sigue siempre con la misma sucursal (por una cookie y por el código de su
navegador, así un doble toque no la manda a las dos). Se configura en **/admin → Anuncio**.

## Equipo y locales

En **/admin → Equipo y locales** se cargan las personas del equipo (foto, nombre, puesto, sucursal donde trabaja y si se
ven en la página) y hasta 12 fotos por local. Se ven en la página principal (Historia): el equipo, y cada local con su
foto principal y miniaturas. En las páginas de cada categoría, las fotos de los locales van en el carrusel de sucursales.
Las fotos JPG grandes del celular se achican a 1600 px antes de subirse.

## Carpetas

```
servidor.js        arranque y rutas
nucleo/            entorno, archivos, contenido (sitio), estadísticas, reparto, sesión, pagos, páginas y API del panel
plantillas/        HTML de los dos diseños y del panel, con marcas {{...}} que completa el servidor
publico/           CSS, JS, fotos y logos que se publican tal cual
semilla/           contenido de fábrica
datos/             lo que se genera al usarla (no va a GitHub): config.json, sitio.json, estadisticas.json,
                   reparto.json, pedidos.json, registro/AAAA-MM-DD.jsonl, backups/ y subidas/
```

**Al actualizar la tienda no se pisa `datos/`.** En el servidor conviene ponerla fuera de la carpeta del código con
`DATOS=/var/lib/xoxo-tienda` en `.env`.

Los datos se guardan como en la v2: cada evento se anota en el registro del día (la fuente de verdad), los totales se
calculan desde ahí, cada versión del contenido queda copiada y, si un archivo se daña, se recupera desde la última copia
o desde el registro. En la etapa 4 todo esto pasa a una base de datos.
