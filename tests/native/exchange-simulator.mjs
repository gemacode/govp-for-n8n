import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';

const port = Number(process.env.GOVP_NATIVE_PORT || 18788);
const issuedByKey = new Map();
const webhooks = new Map();
const encoder = new TextEncoder();
const signingKeyId = 'native-webhook-key';
const signingKeyPair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);
const publicJwk = await crypto.subtle.exportKey('jwk', signingKeyPair.publicKey);

function compareUtf8(left, right) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = a[index] - b[index];
    if (difference) return difference;
  }
  return a.length - b.length;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => compareUtf8(left, right))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

function canonicalJson(value) { return JSON.stringify(canonicalValue(value)); }

async function signedEnvelope(eventId) {
  const event = {
    schema: 'org.govp.exchange.webhook/1',
    id: eventId,
    type: 'govp.issued',
    occurredAt: new Date().toISOString(),
    connectorId: 'native-n8n-test',
    data: { requestId: null, issuanceId: 'native-issuance-1', metadata: { source: 'native-test' } },
  };
  const canonical = canonicalJson(event);
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(canonical));
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingKeyPair.privateKey,
    encoder.encode(canonical),
  );
  return {
    event,
    payloadSha256: Buffer.from(digest).toString('hex'),
    signature: {
      algorithm: 'ECDSA_P256_SHA256',
      keyId: signingKeyId,
      value: Buffer.from(signature).toString('base64url'),
      publicJwk,
    },
  };
}

function reply(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { data += chunk; });
    request.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

const handler = async (request, response) => {
  if (request.headers.authorization !== 'Bearer native-test-token') {
    reply(response, 401, { error: 'invalid_token' });
    return;
  }

  if (request.method === 'GET' && request.url === '/connectors/me') {
    reply(response, 200, { connectorId: 'native-n8n-test', status: 'active' });
    return;
  }

  if (request.method === 'GET' && request.url === `/keys/${signingKeyId}`) {
    reply(response, 200, { key: { keyId: signingKeyId, status: 'active', publicJwk } });
    return;
  }

  if (request.method === 'GET' && request.url === '/connectors/webhooks') {
    reply(response, 200, { webhooks: [...webhooks.values()].map(({ id, status }) => ({ id, status })) });
    return;
  }

  if (request.method === 'POST' && request.url === '/connectors/webhooks') {
    const body = await readJson(request);
    if (!String(body.url || '').startsWith('https://') || !Array.isArray(body.events)) {
      reply(response, 422, { error: 'invalid_webhook' });
      return;
    }
    const id = `native-webhook-${webhooks.size + 1}`;
    webhooks.set(id, { id, url: body.url, events: body.events, status: 'active' });
    reply(response, 201, {
      webhook: { id, status: 'active', events: body.events },
      verification: { keyUrl: `https://host.docker.internal:${port}/keys/${signingKeyId}` },
    });
    return;
  }

  const webhookDelete = request.url?.match(/^\/connectors\/webhooks\/([^/]+)$/);
  if (request.method === 'DELETE' && webhookDelete) {
    const webhook = webhooks.get(decodeURIComponent(webhookDelete[1]));
    if (!webhook) {
      reply(response, 404, { error: 'not_found' });
      return;
    }
    webhook.status = 'disabled';
    reply(response, 200, { webhook: { id: webhook.id, status: webhook.status } });
    return;
  }

  if (request.method === 'GET' && request.url === '/native/webhooks') {
    reply(response, 200, { webhooks: [...webhooks.values()] });
    return;
  }

  if (request.method === 'POST' && request.url === '/native/emit') {
    const body = await readJson(request);
    const webhook = [...webhooks.values()].find((item) => item.status === 'active' && item.events.includes('govp.issued'));
    if (!webhook) {
      reply(response, 409, { error: 'no_active_webhook' });
      return;
    }
    const envelope = await signedEnvelope(String(body.eventId || 'native-event-1'));
    try {
      const delivery = await fetch(webhook.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      });
      const callbackBody = await delivery.text();
      reply(response, 200, { callbackStatus: delivery.status, callbackBody, eventId: envelope.event.id });
    } catch (error) {
      reply(response, 200, { callbackStatus: 599, callbackBody: String(error), eventId: envelope.event.id });
    }
    return;
  }

  if (request.method === 'POST' && request.url === '/connectors/issue') {
    const body = await readJson(request);
    const key = request.headers['idempotency-key'];
    if (!key) {
      reply(response, 400, { error: 'missing_idempotency_key' });
      return;
    }
    const previous = issuedByKey.get(key);
    if (previous) {
      reply(response, 200, { ...previous, replayed: true });
      return;
    }
    const result = {
      code: `GOVP-NATIVE-${issuedByKey.size + 1}`,
      status: 'issued',
      subject: body.subject,
      replayed: false,
    };
    issuedByKey.set(key, result);
    reply(response, 201, result);
    return;
  }

  const verify = request.url?.match(/^\/govps\/([^/]+)$/);
  if (request.method === 'GET' && verify) {
    reply(response, 200, { code: decodeURIComponent(verify[1]), status: 'valid' });
    return;
  }

  const revoke = request.url?.match(/^\/connectors\/govps\/([^/]+)\/revoke$/);
  if (request.method === 'POST' && revoke) {
    const body = await readJson(request);
    reply(response, 200, { code: decodeURIComponent(revoke[1]), status: 'revoked', reason: body.reason });
    return;
  }

  reply(response, 404, { error: 'not_found' });
};

const server = process.env.GOVP_NATIVE_CERT && process.env.GOVP_NATIVE_KEY
  ? createHttpsServer({
      cert: readFileSync(process.env.GOVP_NATIVE_CERT),
      key: readFileSync(process.env.GOVP_NATIVE_KEY),
    }, handler)
  : createHttpServer(handler);

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`GOVP native simulator listening on ${port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
