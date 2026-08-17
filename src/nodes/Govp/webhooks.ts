export const GOVP_WEBHOOK_SCHEMA = 'org.govp.exchange.webhook/1' as const;
export const webhookEventTypes = ['govp.issued', 'govp.verified', 'govp.revoked', 'govp.superseded'] as const;
export type WebhookEventType = typeof webhookEventTypes[number];

export type SignedWebhookEnvelope = {
  event: {
    schema: typeof GOVP_WEBHOOK_SCHEMA;
    id: string;
    type: WebhookEventType;
    occurredAt: string;
    connectorId: string;
    data: { requestId: string | null; issuanceId: string | null; metadata: Record<string, unknown> };
  };
  payloadSha256: string;
  signature: { algorithm: 'ECDSA_P256_SHA256'; keyId: string; value: string; publicJwk: JsonWebKey };
};

const encoder = new TextEncoder();
const recentEventKeys = new Set<string>();
const recentEventOrder: string[] = [];
const recentEventLimit = 500;

export function registerWebhookEvent(eventKey: string): boolean {
  if (recentEventKeys.has(eventKey)) return false;
  recentEventKeys.add(eventKey);
  recentEventOrder.push(eventKey);
  while (recentEventOrder.length > recentEventLimit) {
    const oldest = recentEventOrder.shift();
    if (oldest) recentEventKeys.delete(oldest);
  }
  return true;
}
function compareUtf8(left: string, right: string) {
  const a = encoder.encode(left); const b = encoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = a[index]! - b[index]!;
    if (difference) return difference;
  }
  return a.length - b.length;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => compareUtf8(left, right)).map(([key, child]) => [key, canonicalValue(child)]),
  );
  return value;
}

export function canonicalWebhookJson(value: unknown) { return JSON.stringify(canonicalValue(value)); }

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const bytes = Buffer.from(value, 'base64url');
  return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

export async function verifyWebhookEnvelope(
  envelope: SignedWebhookEnvelope,
  trustedPublicJwk: JsonWebKey,
  now = new Date(),
  toleranceSeconds = 300,
): Promise<boolean> {
  try {
    if (envelope.event.schema !== GOVP_WEBHOOK_SCHEMA || envelope.signature.algorithm !== 'ECDSA_P256_SHA256') return false;
    const occurredAt = Date.parse(envelope.event.occurredAt);
    if (!Number.isFinite(occurredAt) || Math.abs(now.getTime() - occurredAt) > toleranceSeconds * 1000) return false;
    if (canonicalWebhookJson(envelope.signature.publicJwk) !== canonicalWebhookJson(trustedPublicJwk)) return false;
    const canonical = canonicalWebhookJson(envelope.event);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(canonical)));
    if (Buffer.from(digest).toString('hex') !== envelope.payloadSha256) return false;
    const key = await crypto.subtle.importKey('jwk', trustedPublicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, key, decodeBase64Url(envelope.signature.value), encoder.encode(canonical),
    );
  } catch {
    return false;
  }
}
