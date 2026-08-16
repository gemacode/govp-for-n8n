import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';

const port = Number(process.env.GOVP_NATIVE_PORT || 18788);
const issuedByKey = new Map();

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
