#!/bin/bash
# Publica la última versión de la tienda (rama main de GitHub) en el VPS.
# Lo corre GitHub Actions al subir un cambio: entra como el usuario xoxo con una llave que solo puede
# ejecutar este script. En el servidor está instalado en /usr/local/bin/xoxo-desplegar (esta es la copia de referencia).
# Si la tienda no responde después de reiniciarla, vuelve sola a la versión anterior.
set -uo pipefail

APP=/srv/xoxo-tienda
URL=http://127.0.0.1:3000/red-social/

# Un deploy por vez
exec 9>/tmp/xoxo-desplegar.lock
flock -w 300 9 || { echo "Hay otro deploy en curso"; exit 1; }

cd "$APP" || { echo "No existe $APP"; exit 1; }
antes=$(git rev-parse HEAD)
git fetch --quiet origin main || { echo "No se pudo bajar el código de GitHub"; exit 1; }
git reset --hard --quiet origin/main
ahora=$(git rev-parse HEAD)
echo "Versión: ${antes:0:7} -> ${ahora:0:7}"

# Dependencias (el SDK de Anthropic del chat): se instalan solo si cambió package-lock.json o todavía no están
dependencias() {
  if [ -f package-lock.json ] && { [ ! -d node_modules ] || ! git diff --quiet "$1" "$2" -- package-lock.json; }; then
    echo "Instalando dependencias…"
    npm ci --omit=dev --no-audit --no-fund --loglevel=error
  fi
}

volver() {
  echo "ERROR: $1. Vuelvo a la versión ${antes:0:7}."
  git reset --hard --quiet "$antes"
  dependencias "$ahora" "$antes" || true
  sudo /usr/bin/systemctl restart xoxo-tienda
  exit 1
}

dependencias "$antes" "$ahora" || volver "no se pudieron instalar las dependencias"

for f in servidor.js nucleo/*.js; do
  node --check "$f" 2>/dev/null || volver "$f tiene un error"
done

sudo /usr/bin/systemctl restart xoxo-tienda
for i in $(seq 1 20); do
  sleep 1
  if curl -fsS -o /dev/null --max-time 3 "$URL"; then
    echo "Listo: la tienda responde con la versión ${ahora:0:7}."
    exit 0
  fi
done
volver "la tienda no responde"
