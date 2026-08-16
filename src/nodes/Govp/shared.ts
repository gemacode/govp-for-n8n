export type IssueFields = {
  issuerName: string;
  recipientName?: string;
  subjectType: 'product' | 'lot' | 'order' | 'shipment' | 'service';
  subjectId: string;
  subjectName: string;
  requirement: string;
  evidenceJson: string;
  validUntil: string;
  externalId?: string;
};

export function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new TypeError('GOVP Exchange requiere HTTPS.');
  return url.toString().replace(/\/$/, '');
}

export function parseEvidence(value: string) {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.length) throw new TypeError('Evidence JSON debe ser un array no vacío.');
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || typeof (item as { label?: unknown }).label !== 'string') throw new TypeError('Cada evidencia necesita label.');
    const sha = (item as { sha256?: unknown }).sha256;
    if (sha !== undefined && (typeof sha !== 'string' || !/^[a-f0-9]{64}$/.test(sha))) throw new TypeError('sha256 de evidencia no válida.');
  }
  return parsed as Array<{ label: string; sha256?: string; url?: string }>;
}

export function buildIssueBody(fields: IssueFields) {
  return {
    issuer: { name: fields.issuerName },
    ...(fields.recipientName ? { recipient: { name: fields.recipientName } } : {}),
    subject: { type: fields.subjectType, id: fields.subjectId, name: fields.subjectName },
    requirement: fields.requirement,
    evidence: parseEvidence(fields.evidenceJson),
    validUntil: new Date(fields.validUntil).toISOString(),
    source: { platform: 'n8n', ...(fields.externalId ? { externalId: fields.externalId } : {}) },
  };
}

export function validateIdempotencyKey(value: string) {
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(value)) throw new TypeError('Idempotency Key debe contener entre 8 y 160 caracteres seguros.');
  return value;
}
