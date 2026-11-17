# Publicación en el VPS

Cada cambio que se sube a la rama `main` se publica solo en el VPS de DonWeb con GitHub Actions
(`.github/workflows/deploy.yml`):

1. GitHub revisa que el código no tenga errores y prueba arrancar la tienda.
2. Entra al servidor como el usuario `xoxo` con una llave que solo puede correr el script de publicación
   (secreto del repositorio `VPS_SSH_KEY`).
3. El servidor baja el código nuevo, lo revisa, reinicia la tienda y comprueba que responda. Si no responde,
   vuelve solo a la versión anterior.

El resultado de cada publicación se ve en la pestaña **Actions** del repositorio.

## Cómo está armado el servidor

| Qué | Dónde |
|---|---|
| Código (una copia del repositorio) | `/srv/xoxo-tienda`, del usuario `xoxo` |
| Datos: contenido, estadísticas, pedidos, fotos subidas | `/var/lib/xoxo-tienda` |
| Ajustes y claves de las pasarelas (secreto) | `/etc/xoxo-tienda.env` |
| Servicio | `xoxo-tienda` (systemd): `systemctl status xoxo-tienda`, logs con `journalctl -u xoxo-tienda` |
| Script de publicación | `/usr/local/bin/xoxo-desplegar` (copia en `deploy/desplegar.sh`) |
| Carga de claves | `/usr/local/bin/xoxo-claves` (copia en `deploy/claves.js`) |
| Paso al dominio propio | `/usr/local/bin/xoxo-dominio` (copia en `deploy/dominio.sh`; todavía sin instalar) |
| Correo | Postfix de DonWeb, obligado a salir por su relay `200.58.104.74`: la tienda no lo usa, manda por SMTP a Brevo (ver [CORREO.md](CORREO.md)) |
| nginx (https, Let's Encrypt) | `/etc/nginx/sites-available/vps-4728832-x` (bloque de referencia en `deploy/nginx-tienda.conf`) |
| Firewall | ufw: solo 80, 443 y SSH (5576 y 22) |

- La tienda escucha solo en `127.0.0.1:3000`; desde internet se entra por nginx.
- El servidor baja el código de GitHub con una llave de solo lectura (deploy key "VPS DonWeb" del repositorio),
  así sigue funcionando cuando el repositorio pase a privado.
- `xoxo` no es administrador: solo puede reiniciar su propio servicio.
- La contraseña inicial del panel se ve con `xoxo-clave-inicial` (como root). Después del primer ingreso queda cifrada.

## Cargar las claves (Mercado Pago, GO cuotas, WhatsApp del socio, Claude y correo)

Desde una terminal de la computadora:

```
ssh -t xoxo-vps xoxo-claves
```

Es un menú. Lo que pegás como clave no se ve en pantalla. Antes de guardar, cada clave se prueba contra su
servicio: si no anda, no se guarda. Además dice si la cuenta es **de prueba** o **real**. Al guardar, reinicia la
tienda y deja una copia del archivo anterior en `/etc/xoxo-tienda.env.anterior`.

La opción **6) Correo** carga el servidor SMTP con el que la tienda manda los mails (ver [CORREO.md](CORREO.md)):
se conecta e inicia sesión sin mandar nada, y si anda lo guarda.

Las claves nunca van al chat, a GitHub ni al panel. En el panel, **Pedidos → Pasarelas de pago** muestra en qué
modo está cada medio y tiene el botón **Probar conexión**.

Si en `deploy/claves.js` cambia algo, hay que volver a copiarlo al servidor
(`/usr/local/bin/xoxo-claves`, de root, 755). No se usa directo desde `/srv/xoxo-tienda` a propósito: así un push
a GitHub nunca puede cambiar algo que corre como root.

## Probar la pasarela sin cobrar

**Mercado Pago (Checkout Pro)**

1. En [mercadopago.com.ar/developers](https://www.mercadopago.com.ar/developers/panel/app), crear una aplicación
   (Pagos online → Checkout Pro) si no hay una.
2. En la aplicación, ir a **Cuentas de prueba** y crear una cuenta **Comprador** (Argentina). La vendedora de prueba
   ya viene creada.
3. **Credenciales de prueba → Access Token** (empieza con `APP_USR-`) → cargarlo con `xoxo-claves`, opción 1.
   Tiene que decir "cuenta de PRUEBA".
4. Comprar en la tienda con Mercado Pago. En la página de Mercado Pago, entrar con el usuario y la contraseña de
   la cuenta **compradora** de prueba y pagar con una
   [tarjeta de prueba](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/integration-test/test-purchases).
   Como titular, `APRO` aprueba el pago y `OTHE` lo rechaza.
5. Volver a la tienda y mirar el pedido en el panel: tiene que quedar **Pagado**, y en Pasarelas de pago tiene que
   aparecer la hora del último aviso.

**GO cuotas**

Cada sucursal tiene dos API keys: una de **sandbox** (prueba) y otra de **producción**. Están en el panel de GO
cuotas → Sucursales → Editar → "Ver ApiKeys de la sucursal". Se cargan con `xoxo-claves`, opción 2: el **email de
la sucursal** y, en lugar de la contraseña, la API key. La tienda inicia sesión con los dos datos y GO cuotas le
devuelve un token. El sandbox no acepta la API key sola, sin el email.

Para la prueba, en la página de GO cuotas se paga con el usuario de prueba del sandbox. Si el login no anda, hay
que pedir a integraciones@gocuotas.com que habiliten la API Redirect V1 en esa sucursal.

**Para cobrar de verdad:** cargar las credenciales de producción de los dos medios y apagar el pago simulado
(opción 3).

## Chat "Cambios por IA" (etapa 5)

Tu socio entra al panel, abre la pestaña **Cambios por IA** y escribe ahí lo que quiere cambiar. Puede mandar
fotos y grabar audios de hasta 5 minutos. En la computadora, mientras se graba, el navegador pasa el audio a texto
("Lo que dijo"). En el celular eso no se puede, porque el dictado y la grabación se pelean por el micrófono: ahí el
audio llega sin texto. Para que Claude lo entienda, conviene dictar con el micrófono del teclado. Claude lee esos pedidos y contesta en el mismo chat. Las respuestas aparecen solas en unos segundos, y si el
socio está en otra pestaña, ve un aviso rojo en "Cambios por IA".

Los mensajes se guardan en `/var/lib/xoxo-tienda/chat/mensajes.jsonl`. Claude los lee y contesta desde la
computadora:

```
ssh xoxo-vps 'sudo -u xoxo node /srv/xoxo-tienda/deploy/chat.js'            # lo que espera respuesta
ssh xoxo-vps 'sudo -u xoxo node /srv/xoxo-tienda/deploy/chat.js todo 30'    # los últimos 30 mensajes
ssh xoxo-vps 'sudo -u xoxo node /srv/xoxo-tienda/deploy/chat.js escribiendo'  # "Claude está escribiendo…"
ssh xoxo-vps 'sudo -u xoxo node /srv/xoxo-tienda/deploy/chat.js responder' < respuesta.txt
```

En el panel, cada mensaje pasa por estos estados:

1. **Enviando…** mientras sale.
2. **✓ Recibido** cuando el servidor lo guardó. Si no salió, aparece **Reintentar**.
3. **✓✓ Visto por Claude** cuando lo leí.
4. **Claude está escribiendo…** mientras preparo la respuesta.

Hay que correrlo como `xoxo`, nunca como root: si root crea la carpeta del chat, la tienda después no puede
escribir en ella.

### Claude contesta solo

Con una API key de Anthropic cargada, Claude (Opus 5.5) contesta el chat en unos segundos. Así funciona:

- Lee los últimos mensajes, incluidas las fotos y las transcripciones de los audios.
- Busca en el catálogo antes de hablar de precios.
- Anota los pedidos de cambio para que Juan los aplique. Todavía no cambia la tienda por su cuenta.

Para prenderlo:

1. En [console.anthropic.com](https://console.anthropic.com), cargá crédito en **Billing** y poné un límite de gasto por mes.
2. En **API Keys → Create Key**, creá una clave.
3. Cargala con `ssh -t xoxo-vps xoxo-claves`, opción 5. Al guardar, la tienda dice si Claude quedó conectado.

Si un pedido toca un tema delicado y Opus no lo quiere responder, la API lo reintenta sola con otro modelo
("fallbacks"). Como freno, Claude contesta hasta 40 veces por hora. Si la clave falla o se termina el crédito, lo
avisa una vez en el chat.

Los pedidos anotados se ven con:

```
ssh xoxo-vps 'sudo -u xoxo node /srv/xoxo-tienda/deploy/chat.js pedidos'
```

La tienda usa una sola dependencia, el SDK de Anthropic. El script de publicación corre `npm ci` cuando cambia
`package-lock.json`.

## WhatsApp del socio (en pausa)

Quedó armado, pero por ahora se usa el chat del panel porque no hay otro número de teléfono para la tienda.

Cuando se active: el socio le escribe a un número de WhatsApp de la tienda. Por ahora la tienda anota el mensaje en
`/var/lib/xoxo-tienda/socio/mensajes.jsonl` y le contesta que llegó. Solo atiende a los números autorizados.
El próximo paso es que Claude haga el cambio y lo publique cuando el socio confirme.

1. En [developers.facebook.com](https://developers.facebook.com/apps), crear una app de tipo **Negocios**
   (caso de uso: conectarse con clientes por WhatsApp) y elegir o crear el portfolio comercial.
2. En **WhatsApp → Configuración de la API**:
   - copiar el **Identificador del número de teléfono** del número de prueba;
   - en "Para", agregar tu número y el del socio (a cada uno le llega un código por WhatsApp).
3. Token permanente: en [business.facebook.com](https://business.facebook.com/settings/system-users) →
   Usuarios del sistema → Agregar (rol Administrador).
   - Asignarle la app y la cuenta de WhatsApp con control total.
   - Generar token: elegir la app, los permisos `whatsapp_business_messaging` y `whatsapp_business_management`, y
     caducidad **Nunca**.
4. Clave secreta de la app: en la app → **Configuración de la app → Básica → Clave secreta de la app**.
5. `ssh -t xoxo-vps xoxo-claves` → opción 4: pegar los tres datos y los números autorizados. Al terminar, muestra
   la dirección del webhook y el token de verificación.
6. En Meta, ir a **WhatsApp → Configuración → Webhook → Editar**, pegar la dirección y el token, y tocar
   Verificar y guardar. Después, en **Campos del webhook**, suscribirse a `messages`.
7. Escribirle al número de prueba desde un número autorizado: tiene que contestar al instante. Si no contesta,
   mirar el panel en **Cuenta → WhatsApp del socio** o los logs con `journalctl -u xoxo-tienda -n 50`.

## Cambiar de dominio

Paso a paso en [DOMINIO.md](DOMINIO.md): delegar el dominio, cargar los registros A y correr
`ssh -t xoxo-vps xoxo-dominio xoxotecno.com.ar tu@email.com`, que arma nginx, saca el certificado https, cambia
`BASE_URL` y deja la dirección vieja redirigiendo al dominio nuevo.
