# XOXO Tecno · Tienda (Node)

La tienda completa en Node.js: los dos diseños (**Red social** y **Minimalista**) con prueba A/B, el panel **/admin**,
las estadísticas, el reparto de WhatsApp entre sucursales y el **pago online con GO cuotas y Mercado Pago**.
No usa dependencias: alcanza con Node 18 o más nuevo.

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
| `/` | Entrada: manda a cada visitante a uno de los dos diseños |
| `/anuncio/` | Lo mismo, para los anuncios (queda registrado como origen "anuncio"; `?src=instagram` separa la red) |
| `/red-social/` y `/minimalista/` | Cada diseño (con `?ver` se ve aunque esté apagado) |
| `/admin/` | Panel: estadísticas, pedidos, anuncio y sucursales, productos, textos, registro, copias y cuenta |

## Pago online

Las claves van en `.env` (ver `.env.example`): `MP_ACCESS_TOKEN` para Mercado Pago y `GOCUOTAS_EMAIL` /
`GOCUOTAS_PASSWORD` para GO cuotas. `BASE_URL` tiene que ser la dirección pública con https, para que las pasarelas
avisen los pagos.

- Con al menos un medio activo, las páginas muestran **Comprar ahora** y el checkout. Sin ninguno, la tienda funciona
  solo con WhatsApp.
- `PAGOS_DEMO=true` muestra un pago simulado en los medios sin clave, para probar el recorrido sin cobrar.
- El precio sale del contenido de la tienda, nunca del navegador. Un pago se da por aprobado solo después de
  consultarlo en la API de la pasarela.
- Cuotas: celulares en 12 con tarjeta de crédito (Mercado Pago) o 9 con débito (GO cuotas); los otros productos en 6
  con GO cuotas o en un pago con Mercado Pago. Las cuotas reales se configuran en cada pasarela.
- Los pedidos se ven en **/admin → Pedidos**, con el WhatsApp del comprador para coordinar la entrega.

## Sucursales y WhatsApp

Todos los botones de WhatsApp pasan por `/api/whatsapp`, que elige la sucursal: cada persona nueva va a la que hoy
recibió menos personas. La misma persona sigue siempre con la misma sucursal (por una cookie y por el código de su
navegador, así un doble toque no la manda a las dos). Se configura en **/admin → Anuncio**.

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
