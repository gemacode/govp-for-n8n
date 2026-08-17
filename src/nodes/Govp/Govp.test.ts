import { describe, expect, it } from 'vitest';
import { GovpExchangeApi } from '../../credentials/GovpExchangeApi.credentials.js';
import { Govp } from './Govp.node.js';
import { GovpTrigger } from './GovpTrigger.node.js';
import { buildIssueBody, normalizeBaseUrl, parseEvidence, validateIdempotencyKey } from './shared.js';
import { GOVP_WEBHOOK_SCHEMA, canonicalWebhookJson, registerWebhookEvent, verifyWebhookEnvelope, type SignedWebhookEnvelope } from './webhooks.js';

describe('n8n GOVP node', () => {
  it('declara tres operaciones y una credencial obligatoria', () => {
    const node = new Govp();
    const operation = node.description.properties.find((item) => item.name === 'operation');
    expect(operation?.options).toHaveLength(3);
    expect(node.description.credentials).toEqual([{ name: 'govpExchangeApi', required: true }]);
    expect(node.description.usableAsTool).toBe(true);
  });

  it('mantiene el token como credencial de contraseña', () => {
    const credentials = new GovpExchangeApi();
    expect(credentials.properties.find((item) => item.name === 'token')?.typeOptions).toMatchObject({ password: true });
    expect(credentials.test.request.url).toBe('/connectors/me');
  });

  it('construye el contrato canónico n8n sin datos adicionales', () => {
    const body = buildIssueBody({
      issuerName: 'Empresa ficticia', subjectType: 'shipment', subjectId: 'SHIP-1', subjectName: 'Shipment 1',
      requirement: 'Proof of shipment', evidenceJson: '[{"label":"Digest","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]',
      validUntil: '2027-08-16T00:00:00Z', externalId: 'SHIP-1',
    });
    expect(body).toMatchObject({ source: { platform: 'n8n', externalId: 'SHIP-1' }, subject: { type: 'shipment', id: 'SHIP-1' } });
    expect(body.evidence[0]?.sha256).toHaveLength(64);
  });

  it('rechaza evidencia e idempotencia inválidas', () => {
    expect(() => parseEvidence('[]')).toThrow(/array no vacío/);
    expect(() => parseEvidence('[{"label":"x","sha256":"bad"}]')).toThrow(/sha256/);
    expect(() => validateIdempotencyKey('short')).toThrow(/8 y 160/);
    expect(validateIdempotencyKey('order:123456')).toBe('order:123456');
  });

  it('exige HTTPS fuera del simulador local', () => {
    expect(() => normalizeBaseUrl('http://example.com/api')).toThrow(/HTTPS/);
    expect(normalizeBaseUrl('https://partners.gemacode.org/api/exchange/')).toBe('https://partners.gemacode.org/api/exchange');
    expect(normalizeBaseUrl('http://localhost:8788')).toBe('http://localhost:8788');
  });

  it('declara un trigger webhook para eventos GOVP seleccionables', () => {
    const trigger = new GovpTrigger();
    expect(trigger.description.group).toEqual(['trigger']);
    expect(trigger.description.webhooks?.[0]).toMatchObject({ httpMethod: 'POST', responseMode: 'onReceived' });
    expect(trigger.description.properties.find((item) => item.name === 'events')?.type).toBe('multiOptions');
  });

  it('verifica el evento solo contra una clave confiable y dentro de su ventana', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey;
    const event = { schema: GOVP_WEBHOOK_SCHEMA, id: 'event-1', type: 'govp.issued' as const, occurredAt: '2026-08-17T14:00:00Z', connectorId: 'connector-1', data: { requestId: null, issuanceId: 'issuance-1', metadata: {} } };
    const canonical = canonicalWebhookJson(event);
    const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))).toString('hex');
    const signature = Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(canonical))).toString('base64url');
    const envelope: SignedWebhookEnvelope = { event, payloadSha256: digest, signature: { algorithm: 'ECDSA_P256_SHA256', keyId: 'key-1', value: signature, publicJwk } };
    await expect(verifyWebhookEnvelope(envelope, publicJwk, new Date('2026-08-17T14:01:00Z'))).resolves.toBe(true);
    const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
    await expect(verifyWebhookEnvelope(envelope, await crypto.subtle.exportKey('jwk', other.publicKey) as JsonWebKey, new Date('2026-08-17T14:01:00Z'))).resolves.toBe(false);
  });

  it('rechaza un replay inmediato dentro del mismo runtime n8n', () => {
    const eventKey = `native-test:${crypto.randomUUID()}`;
    expect(registerWebhookEvent(eventKey)).toBe(true);
    expect(registerWebhookEvent(eventKey)).toBe(false);
  });
});
