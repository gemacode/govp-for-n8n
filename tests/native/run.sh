#!/usr/bin/env bash
set -euo pipefail

connector_dir="$(cd "$(dirname "$0")/../.." && pwd)"
runtime_image="${N8N_NATIVE_IMAGE:-n8nio/n8n:latest}"
native_dir="$(mktemp -d /tmp/govp-n8n-native.XXXXXX)"
simulator_pid=""

cleanup() {
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

docker image inspect "$runtime_image" >/dev/null 2>&1 || docker pull "$runtime_image"
docker run --rm --user root \
  -v "$native_dir:/home/node/.n8n" -v "$package:/tmp/n8n-nodes-govp.tgz:ro" \
  --entrypoint sh "$runtime_image" -lc \
  'mkdir -p /home/node/.n8n/nodes && cd /home/node/.n8n/nodes && npm init -y >/dev/null && npm install --omit=dev --legacy-peer-deps /tmp/n8n-nodes-govp.tgz >/dev/null && ln -s /usr/local/lib/node_modules/n8n/node_modules/n8n-workflow node_modules/n8n-workflow && chown -R node:node /home/node/.n8n'

docker run --rm -v "$native_dir:/home/node/.n8n" \
  -v "$connector_dir/tests/native:/fixtures:ro" "$runtime_image" \
  import:credentials --input=/fixtures/credentials.json >/dev/null
docker run --rm -v "$native_dir:/home/node/.n8n" \
  -v "$connector_dir/tests/native:/fixtures:ro" "$runtime_image" \
  import:workflow --input=/fixtures/workflow.json >/dev/null

for attempt in first replay; do
  docker run --rm -e NODE_TLS_REJECT_UNAUTHORIZED=0 \
    -v "$native_dir:/home/node/.n8n" "$runtime_image" \
    execute --id=govp-native-acceptance-v2 --rawOutput >"$native_dir/$attempt.json"
done

grep -q '"replayed": false' "$native_dir/first.json"
grep -q '"replayed": true' "$native_dir/replay.json"
grep -q '"status": "success"' "$native_dir/first.json"
grep -q '"status": "success"' "$native_dir/replay.json"
echo "PASS: paquete cargado y emisión idempotente ejecutada dos veces en n8n."
