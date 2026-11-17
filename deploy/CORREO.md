# Correo de la tienda: @xoxotecno.com.ar

## Cómo queda armado

```
              Clientes y proveedores
                     │  escriben a ventas@xoxotecno.com.ar
                     ▼
   ┌───────────────────────────────┐        ┌────────────────────────────────┐
   │ Casillas: Zoho Mail (gratis)  │        │ Tienda en el VPS (nucleo/correo)│
   │ ventas@, hola@, una por socio │        │ cuando se aprueba un pago:      │
   │ webmail + app del celular     │        │  · mail de compra al cliente    │
   └───────────────────────────────┘        │  · aviso de venta a ventas@     │
                     ▲                      └───────────────┬────────────────┘
                     │ el aviso de venta llega acá          │ SMTP (587, cifrado)
                     │                                      ▼
                     │                      ┌────────────────────────────────┐
                     └──────────────────────│ Brevo: manda los mails de la    │
                                            │ tienda con el dominio verificado│
                                            │ (gratis hasta 300 por día)      │
                                            └────────────────────────────────┘
```

- **Recibir y contestar** (personas): casillas en **Zoho Mail**. El plan gratis tiene hasta 5 casillas de 5 GB
  con webmail y app para el celular. Si después quieren usar Outlook o Gmail con IMAP, el plan pago más barato
  de Zoho lo permite. Google Workspace también sirve, pero es pago desde la primera casilla.
- **Mandar desde la tienda** (automático): **Brevo** por SMTP. Con el dominio verificado (DKIM y DMARC), los
  mails llegan a la bandeja de entrada y no a spam. La tienda manda por SMTP estándar, así que se puede cambiar
  de proveedor (Zoho, Amazon SES, Mailgun o un servidor propio) sin tocar el código: solo `xoxo-claves`.
- **La tienda** (`nucleo/correo.js`): arma el mail, lo pone en una cola y lo manda. Si el proveedor no
  responde, reintenta solo a los 1 min, 5 min, 30 min, 2 h y 6 h. Todo queda anotado en el panel, en
  Pedidos → Correos. Sin SMTP configurado, los mails no salen: se guardan y se ven desde el panel.

## Por qué no un servidor de correo propio en el VPS

Lo revisé el 17/11/2026, solo leyendo, sin tocar nada:

- DonWeb **obliga** a que todo el correo del VPS salga por su relay (`relayhost = [200.58.104.74]:25`), y tiene
  un servicio (`postfix-watch`) que deshace cualquier cambio a esa configuración.
- La IP del VPS tiene el nombre inverso de DonWeb (`vps-4728832-x.dattaweb.com`). Gmail y Outlook desconfían de
  los mails que salen de una IP cuyo nombre no coincide con el dominio.
- Un servidor de correo propio necesita mantenimiento constante: spam, listas negras, certificados, copias y
  espacio en disco.

Si más adelante lo quieren igual, la tienda ya habla SMTP: alcanza con apuntar `xoxo-claves` al servidor nuevo.

## Pasos (después de delegar el dominio, ver DOMINIO.md)

1. **Zoho Mail** → zoho.com/mail → plan Forever Free → "Agregar un dominio que ya tengo" → `xoxotecno.com.ar`.
   - Verificar el dominio con el registro TXT que muestra Zoho.
   - Cargar los MX, el SPF y el DKIM que muestra Zoho (tabla de abajo).
   - Crear las casillas: `ventas@`, `hola@` y una por socio.
2. **Brevo** → brevo.com → cuenta gratis → Senders, Domains & Dedicated IPs → Domains → agregar `xoxotecno.com.ar`.
   - Cargar los registros que muestra Brevo: `brevo-code`, DKIM y DMARC.
   - Senders → agregar `ventas@xoxotecno.com.ar`.
   - SMTP & API → SMTP → "Generate a new SMTP key". Ahí también figura el **login** (usuario) del SMTP.
3. **En el VPS**: `ssh -t xoxo-vps xoxo-claves` → opción **6) Correo**.
   - Servidor `smtp-relay.brevo.com`, puerto `587`.
   - Usuario: el login de Brevo. Clave: la SMTP key.
   - Quién manda: `XOXO Tecno <ventas@xoxotecno.com.ar>`.
   - Avisos: `ventas@xoxotecno.com.ar`.
   La prueba se conecta e inicia sesión sin mandar nada. Si anda, **g** guarda y reinicia la tienda.
4. **Probar**: panel → Pedidos → Correos → "Mandar una prueba" a un Gmail propio. Tiene que llegar a la bandeja
   de entrada. Para ver el puntaje, mandar otra prueba a la dirección que da **mail-tester.com** (apuntar a 9/10 o más).

## Registros DNS

Los valores marcados con ⟨…⟩ los genera cada proveedor: se copian tal cual de su panel.

| Tipo | Nombre | Valor | Para qué |
|---|---|---|---|
| A | `@` | `149.50.148.61` | La tienda |
| A | `www` | `149.50.148.61` | La tienda con www |
| MX | `@` | `mx.zoho.com` (prioridad 10) | Recibir correo |
| MX | `@` | `mx2.zoho.com` (prioridad 20) | Recibir correo (respaldo) |
| MX | `@` | `mx3.zoho.com` (prioridad 50) | Recibir correo (respaldo) |
| TXT | `@` | `zoho-verification=⟨…⟩` | Zoho comprueba que el dominio es de ustedes |
| TXT | `@` | `v=spf1 include:zoho.com include:spf.brevo.com ~all` | Quién puede mandar con @xoxotecno.com.ar (uno solo; si Zoho o Brevo muestran otro include, se suma acá) |
| TXT | `zmail._domainkey` | `v=DKIM1; k=rsa; p=⟨…⟩` | Firma de Zoho |
| TXT | `@` | `brevo-code:⟨…⟩` | Brevo comprueba el dominio |
| CNAME o TXT | ⟨el que indique Brevo⟩`._domainkey` | ⟨…⟩ | Firma de Brevo |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:ventas@xoxotecno.com.ar` | Política anti-suplantación. Después de un mes sin problemas, pasar a `p=quarantine` |

Tiene que haber **un solo** registro SPF. Si ya hay uno, se edita.

## Qué mails manda la tienda

| Cuándo | A quién | Asunto |
|---|---|---|
| Se aprueba un pago (Mercado Pago, GO cuotas o el pago simulado) | Al cliente | Recibimos tu pago · pedido #REF |
| Lo mismo | A `CORREO_AVISOS` | Venta #REF: producto · total |
| Prueba desde el panel | A quien se escriba | Prueba de correo de la tienda |

Se mandan una sola vez por pedido. Los textos están en `nucleo/correo.js` (funciones `compra` y `venta`) y
se ven sin comprar nada en panel → Pedidos → Correos → "Ver el mail de compra".

## Si algo falla

- **Panel → Pedidos → Correos** muestra cada mail con su estado. Si un mail espera para reintentar, se ve el error.
- `journalctl -u xoxo-tienda | grep correo` muestra los errores en el servidor.
- "el usuario o la clave no son correctos": generar otra SMTP key en Brevo y cargarla con `xoxo-claves`.
- Llega a spam: revisar que estén el DKIM de Brevo y el DMARC, y probar con mail-tester.com.
