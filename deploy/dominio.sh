#!/bin/bash
# Pasa la tienda al dominio propio (xoxotecno.com.ar) en el VPS. Se corre una vez, como root, cuando el dominio
# ya apunta al servidor (registros A de @ y www con la IP del VPS). Ver deploy/DOMINIO.md.
#
#   xoxo-dominio xoxotecno.com.ar tu@email.com
#
# Qué hace, en orden (si algo falla, frena y no toca lo que sigue):
#   1. Revisa que xoxotecno.com.ar y www.xoxotecno.com.ar ya apunten a este servidor.
#   2. Crea el sitio de nginx para el dominio y lo prueba (nginx -t).
#   3. Saca el certificado https con Let's Encrypt (certbot) y deja http → https.
#   4. Cambia BASE_URL en /etc/xoxo-tienda.env (copia del anterior en .anterior) y reinicia la tienda.
#   5. La dirección vieja (vps-4728832-x.dattaweb.com) manda a las visitas al dominio nuevo, pero sigue
#      recibiendo los avisos de pago (/api/) de los pedidos que se hicieron antes del cambio.
# En el servidor se instala como /usr/local/bin/xoxo-dominio (esta es la copia de referencia): root no corre
# archivos de /srv, que se pueden cambiar con un push.
set -euo pipefail

DOM="${1:-}"
MAIL="${2:-}"
VIEJO=vps-4728832-x.dattaweb.com
ENV=/etc/xoxo-tienda.env
SITIO=/etc/nginx/sites-available/xoxo-tienda-dominio
SITIO_VIEJO=/etc/nginx/sites-available/vps-4728832-x

if [ "$(id -u)" != 0 ]; then echo "Corré xoxo-dominio como root."; exit 1; fi
if ! [[ "$DOM" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || ! [[ "$MAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$ ]]; then
  echo "Uso: xoxo-dominio xoxotecno.com.ar tu@email.com   (el email es para los avisos de Let's Encrypt)"
  exit 1
fi

echo "== 1. ¿El dominio ya apunta a este servidor?"
IP=$(curl -fsS --max-time 8 https://api.ipify.org || hostname -I | awk '{print $1}')
for h in "$DOM" "www.$DOM"; do
  r=$(getent ahostsv4 "$h" | awk '{print $1}' | sort -u | tr '\n' ' ')
  if ! grep -qw "$IP" <<<"$r"; then
    echo "   $h apunta a: ${r:-nada}. Tiene que apuntar a $IP."
    echo "   Cargá el registro A en la zona DNS y esperá a que se propague (puede tardar de minutos a horas)."
    exit 1
  fi
  echo "   $h → $IP ✓"
done

echo "== 2. Sitio de nginx para $DOM"
if [ ! -f "$SITIO" ]; then
  cat > "$SITIO" <<EOF
# Tienda XOXO Tecno en $DOM (lo creó xoxo-dominio). certbot le agrega el https.
server {
    listen 80;
    listen [::]:80;
    server_name $DOM www.$DOM;

    client_max_body_size 32m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
EOF
  ln -sf "$SITIO" /etc/nginx/sites-enabled/
fi
nginx -t
systemctl reload nginx
echo "   ✓"

echo "== 3. Certificado https (Let's Encrypt)"
certbot --nginx -d "$DOM" -d "www.$DOM" --redirect --non-interactive --agree-tos -m "$MAIL" --keep-until-expiring
echo "   ✓ (se renueva solo)"

echo "== 4. La tienda pasa a https://$DOM"
cp -p "$ENV" "$ENV.anterior"
if grep -q '^BASE_URL=' "$ENV"; then sed -i "s#^BASE_URL=.*#BASE_URL=https://$DOM#" "$ENV"; else echo "BASE_URL=https://$DOM" >> "$ENV"; fi
systemctl restart xoxo-tienda
for i in $(seq 1 20); do
  sleep 1
  if curl -fsS -o /dev/null --max-time 5 "https://$DOM/historia/"; then ok=1; break; fi
done
if [ "${ok:-}" != 1 ]; then
  echo "   La tienda no responde en https://$DOM. Vuelvo BASE_URL como estaba."
  cp -p "$ENV.anterior" "$ENV"
  systemctl restart xoxo-tienda
  exit 1
fi
echo "   https://$DOM responde ✓"

echo "== 5. La dirección vieja manda al dominio nuevo (menos los avisos de pago)"
if [ -f "$SITIO_VIEJO" ] && ! grep -q "xoxo-dominio" "$SITIO_VIEJO"; then
  cp -p "$SITIO_VIEJO" "/root/$(basename "$SITIO_VIEJO").antes-del-dominio"
  python3 - "$SITIO_VIEJO" "$DOM" <<'PY'
import re, sys
f, dom = sys.argv[1], sys.argv[2]
s = open(f).read()
nuevo = (
    "    # xoxo-dominio: las visitas van al dominio nuevo; /api/ (avisos de pago de pedidos viejos) sigue llegando\n"
    "    location /api/ {\n"
    "        proxy_pass http://127.0.0.1:3000;\n"
    "        proxy_http_version 1.1;\n"
    "        proxy_set_header Host $host;\n"
    "        proxy_set_header X-Real-IP $remote_addr;\n"
    "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
    "        proxy_set_header X-Forwarded-Proto $scheme;\n"
    "    }\n"
    "    location / {\n"
    "        return 301 https://" + dom + "$request_uri;\n"
    "    }\n"
)
# Reemplaza el primer "location / { ... }" (el del bloque https)
s2, n = re.subn(r"    location / \{.*?\n    \}\n", nuevo, s, count=1, flags=re.S)
if n != 1:
    sys.exit("no encontré el bloque location / del sitio viejo: lo dejo como está")
open(f, "w").write(s2)
PY
  if nginx -t; then systemctl reload nginx; echo "   ✓"; else
    echo "   nginx no aceptó el cambio: vuelvo el sitio viejo como estaba."
    cp -p "/root/$(basename "$SITIO_VIEJO").antes-del-dominio" "$SITIO_VIEJO"
    systemctl reload nginx
  fi
else
  echo "   (ya estaba hecho)"
fi

echo
echo "Listo: la tienda está en https://$DOM"
echo "Falta, fuera del servidor (ver deploy/DOMINIO.md):"
echo "  - Correo: registros MX, SPF, DKIM y DMARC, y cargar el SMTP con xoxo-claves (opción 6)."
echo "  - Mercado Pago y GO cuotas no necesitan cambios: cada pedido les manda la dirección nueva."
echo "  - Si hay anuncios con el link viejo, siguen andando: redirigen solos."
