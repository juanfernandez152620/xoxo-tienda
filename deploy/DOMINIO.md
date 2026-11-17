# Pasar la tienda a xoxotecno.com.ar

Hoy la tienda está en `https://vps-4728832-x.dattaweb.com`. Para que quede en `https://xoxotecno.com.ar`:

## 1. Delegar el dominio (donde se compró)

- **Si es .com.ar** (NIC Argentina, nic.ar, se entra con clave fiscal): Mis dominios → `xoxotecno.com.ar` →
  **Delegar** y cargar los servidores DNS del proveedor que va a tener la "zona DNS".
- **Si se compró en otro lado** (DonWeb, Hostinger…): en ese panel, "Servidores DNS" o "Nameservers".

¿Qué servidores DNS usar? Cualquiera de estas dos opciones sirve:

| Opción | A favor |
|---|---|
| **DNS de DonWeb** (los servidores que muestra su panel) | Mismo proveedor que el VPS: un solo lugar para todo |
| **Cloudflare** (gratis) | Panel muy simple y cambios casi al instante. Usar los registros en modo "DNS only" (nube gris): si no, el certificado https del VPS no se puede sacar |

Si el dominio está a nombre de otra persona, "la transferencia" es el **cambio de titular** en NIC Argentina.
Lo hace el titular actual desde su cuenta, y la cuenta nueva acepta el cambio.

## 2. Cargar los registros en la zona DNS

| Tipo | Nombre | Valor |
|---|---|---|
| A | `@` (o `xoxotecno.com.ar`) | `149.50.148.61` |
| A | `www` | `149.50.148.61` |

En el mismo paso conviene cargar también los del correo: MX, SPF, DKIM y DMARC (ver `CORREO.md`).

Para ver si ya se propagó, desde la compu:

```bash
nslookup xoxotecno.com.ar
nslookup www.xoxotecno.com.ar
```

Los dos tienen que responder `149.50.148.61`. Puede tardar de minutos a unas horas. En NIC Argentina, la
delegación también puede tardar.

## 3. Pasar la tienda al dominio (en el VPS)

El script `deploy/dominio.sh` hace todo de una vez. Se instala como `/usr/local/bin/xoxo-dominio`, copia de
root, igual que `xoxo-claves`. **Todavía no está instalado: lo instalo con tu ok.**

```bash
ssh -t xoxo-vps xoxo-dominio xoxotecno.com.ar tu@email.com
```

Qué hace, en orden (si un paso falla, frena):

1. Revisa que `xoxotecno.com.ar` y `www` ya apunten al VPS.
2. Crea el sitio en nginx y lo prueba.
3. Saca el certificado https con Let's Encrypt (se renueva solo) y manda http → https. El email es para los
   avisos de Let's Encrypt.
4. Cambia `BASE_URL` a `https://xoxotecno.com.ar` y reinicia la tienda. Si no responde, vuelve a como estaba.
5. La dirección vieja (dattaweb) manda las visitas al dominio nuevo. Los avisos de pago (`/api/`) de los pedidos
   hechos antes del cambio siguen llegando.

## 4. Comprobar

- `https://xoxotecno.com.ar/` entra a la tienda (y reparte entre los 3 diseños).
- `https://xoxotecno.com.ar/historia/`, `/red-social/` y `/minimalista/`, con sus categorías:
  `/historia/ventilacion/`, `/historia/contenido/`, `/historia/audio/`…
- `https://xoxotecno.com.ar/admin/`: el panel, con el mismo usuario y clave.
- Una compra de prueba (con el pago simulado o con las credenciales de prueba de Mercado Pago).
- `https://vps-4728832-x.dattaweb.com/` redirige al dominio nuevo.

## Qué no hace falta cambiar

- **Mercado Pago y GO cuotas**: cada pedido les manda la dirección de aviso (webhook) con el dominio que tenga
  la tienda en ese momento.
- **GitHub Actions**: publica por SSH a la IP del VPS, no usa el dominio.
- **Links de anuncios viejos**: redirigen solos al dominio nuevo.

## Para volver atrás

```bash
ssh xoxo-vps
sudo cp /etc/xoxo-tienda.env.anterior /etc/xoxo-tienda.env && sudo systemctl restart xoxo-tienda
sudo cp /root/vps-4728832-x.antes-del-dominio /etc/nginx/sites-available/vps-4728832-x && sudo nginx -t && sudo systemctl reload nginx
```
