import { describe, expect, it } from 'vitest';
import { GovpExchangeApi } from '../../credentials/GovpExchangeApi.credentials.js';
import { Govp } from './Govp.node.js';
import { buildIssueBody, normalizeBaseUrl, parseEvidence, validateIdempotencyKey } from './shared.js';

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
});
