#!/usr/bin/env bash
set -euo pipefail

connector_dir="$(cd "$(dirname "$0")/../.." && pwd)"
runtime_image="${N8N_NATIVE_IMAGE:-n8nio/n8n:latest}"
tunnel_image="${CLOUDFLARED_IMAGE:-cloudflare/cloudflared:latest}"
native_dir="$(mktemp -d /tmp/govp-n8n-trigger.XXXXXX)"
run_suffix="${native_dir##*.}"
n8n_container="govp-n8n-trigger-$run_suffix"
tunnel_container="govp-n8n-tunnel-$run_suffix"
simulator_pid=""

cleanup() {
  docker stop "$n8n_container" "$tunnel_container" >/dev/null 2>&1 || true
  docker rm -f "$n8n_container" "$tunnel_container" >/dev/null 2>&1 || true
  if [[ -n "$simulator_pid" ]]; then kill "$simulator_pid" 2>/dev/null || true; fi
  trash "$native_dir" 2>/dev/null || rm -rf "$native_dir"
}
trap cleanup EXIT

package="$(find "$connector_dir" -maxdepth 1 -name 'n8n-nodes-govp-*.tgz' -print | sort -V | tail -1)"
if [[ -z "$package" ]]; then
  echo "Falta el paquete. Ejecuta npm pack en $connector_dir." >&2
  exit 1
fi

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$native_dir/native-key.pem" -out "$native_dir/native-cert.pem" \
  -days 1 -subj '/CN=host.docker.internal' \
  -addext 'subjectAltName=DNS:host.docker.internal' >/dev/null 2>&1

GOVP_NATIVE_CERT="$native_dir/native-cert.pem" \
GOVP_NATIVE_KEY="$native_dir/native-key.pem" \
node "$connector_dir/tests/native/exchange-simulator.mjs" >"$native_dir/simulator.log" 2>&1 &
simulator_pid="$!"

for _ in $(seq 1 20); do
  if curl -ksS -H 'Authorization: Bearer native-test-token' \
    "https://localhost:18788/connectors/me" >/dev/null; then break; fi
  sleep 1
done

docker image inspect "$runtime_image" >/dev/null 2>&1 || docker pull "$runtime_image"
docker image inspect "$tunnel_image" >/dev/null 2>&1 || docker pull "$tunnel_image"

docker run --rm --user root \
  -e N8N_ENCRYPTION_KEY=native-trigger-encryption-key \
  -v "$native_dir:/home/node/.n8n" -v "$package:/tmp/n8n-nodes-govp.tgz:ro" \
  --entrypoint sh "$runtime_image" -lc \
  'mkdir -p /home/node/.n8n/nodes && cd /home/node/.n8n/nodes && npm init -y >/dev/null && npm install --omit=dev --legacy-peer-deps /tmp/n8n-nodes-govp.tgz >/dev/null && ln -s /usr/local/lib/node_modules/n8n/node_modules/n8n-workflow node_modules/n8n-workflow && chown -R node:node /home/node/.n8n'

docker run --rm -e N8N_ENCRYPTION_KEY=native-trigger-encryption-key \
  -v "$native_dir:/home/node/.n8n" -v "$connector_dir/tests/native:/fixtures:ro" "$runtime_image" \
  import:credentials --input=/fixtures/credentials.json >/dev/null
docker run --rm -e N8N_ENCRYPTION_KEY=native-trigger-encryption-key \
  -v "$native_dir:/home/node/.n8n" -v "$connector_dir/tests/native:/fixtures:ro" "$runtime_image" \
  import:workflow --input=/fixtures/trigger-workflow.json >/dev/null
docker run --rm -e N8N_ENCRYPTION_KEY=native-trigger-encryption-key \
  -v "$native_dir:/home/node/.n8n" "$runtime_image" \
  update:workflow --id=govp-native-trigger-v2 --active=true >/dev/null

docker run -d --name "$tunnel_container" "$tunnel_image" \
  tunnel --no-autoupdate --url http://host.docker.internal:5678 >"$native_dir/tunnel-container-id"

tunnel_url=""
for _ in $(seq 1 40); do
  tunnel_url="$(docker logs "$tunnel_container" 2>&1 | sed -nE 's#.*(https://[a-z0-9-]+\.trycloudflare\.com).*#\1#p' | tail -1)"
  if [[ -n "$tunnel_url" ]]; then break; fi
  sleep 1
done
if [[ -z "$tunnel_url" ]]; then
  docker logs "$tunnel_container" >&2
  echo "No se obtuvo una URL HTTPS de Cloudflare Tunnel." >&2
  exit 1
fi

docker run -d --name "$n8n_container" -p 5678:5678 \
  -e WEBHOOK_URL="$tunnel_url/" \
  -e N8N_ENCRYPTION_KEY=native-trigger-encryption-key \
  -e NODE_TLS_REJECT_UNAUTHORIZED=0 \
  -e N8N_DIAGNOSTICS_ENABLED=false \
  -e N8N_PERSONALIZATION_ENABLED=false \
  -v "$native_dir:/home/node/.n8n" "$runtime_image" >"$native_dir/n8n-container-id"

registered=""
for _ in $(seq 1 45); do
  registered="$(curl -ksS -H 'Authorization: Bearer native-test-token' \
    "https://localhost:18788/native/webhooks" 2>/dev/null || true)"
  if [[ "$registered" == *'"status":"active"'* ]]; then break; fi
  sleep 1
done
if [[ "$registered" != *'"status":"active"'* ]]; then
  docker logs "$n8n_container" >&2
  echo "n8n no registró el webhook nativo." >&2
  exit 1
fi

first=""
for _ in $(seq 1 30); do
  first="$(curl -ksS -X POST -H 'Authorization: Bearer native-test-token' \
    -H 'Content-Type: application/json' -d '{"eventId":"native-trigger-event-1"}' \
    "https://localhost:18788/native/emit")"
  if [[ "$first" == *'"callbackStatus":200'* ]]; then break; fi
  sleep 1
done

if [[ "$first" != *'"callbackStatus":200'* ]]; then
  docker logs "$n8n_container" >&2
  sqlite3 "$native_dir/database.sqlite" '.schema webhook_entity' >&2 || true
  sqlite3 -header -column "$native_dir/database.sqlite" 'SELECT * FROM webhook_entity;' >&2 || true
  echo "La primera entrega nativa no fue aceptada: $first" >&2
  exit 1
fi

sleep 3
replay="$(curl -ksS -X POST -H 'Authorization: Bearer native-test-token' \
  -H 'Content-Type: application/json' -d '{"eventId":"native-trigger-event-1"}' \
  "https://localhost:18788/native/emit")"
if [[ "$replay" != *'"callbackStatus":409'* ]]; then
  echo "La protección de replay no respondió 409: $replay" >&2
  exit 1
fi

docker stop "$n8n_container" >/dev/null
successful="$(sqlite3 "$native_dir/database.sqlite" "SELECT COUNT(*) FROM execution_entity WHERE workflowId='govp-native-trigger-v2' AND status='success';")"
if [[ "${successful:-0}" -lt 1 ]]; then
  echo "n8n no registró una ejecución correcta del trigger." >&2
  exit 1
fi

echo "PASS: trigger instalado y activado en n8n, entrega firmada aceptada, ejecución correcta y replay rechazado."
