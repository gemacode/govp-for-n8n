import {
  NodeConnectionTypes,
  NodeOperationError,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
} from 'n8n-workflow';
import { buildIssueBody, normalizeBaseUrl, validateIdempotencyKey } from './shared.js';

const operation = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options' as const,
  noDataExpression: true,
  options: [
    { name: 'Issue', value: 'issue', action: 'Issue a GOVP' },
    { name: 'Verify', value: 'verify', action: 'Verify a GOVP' },
    { name: 'Revoke', value: 'revoke', action: 'Revoke a GOVP' },
  ],
  default: 'issue',
};

const showIssue = { show: { operation: ['issue'] } };
const showCode = { show: { operation: ['verify', 'revoke'] } };

export class Govp implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'GOVP',
    name: 'govp',
    icon: 'fa:certificate',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Issue, verify and revoke GOVP through GOVP Exchange',
    defaults: { name: 'GOVP' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [{ name: 'govpExchangeApi', required: true }],
    properties: [
      operation,
      { displayName: 'Issuer Name', name: 'issuerName', type: 'string', default: '', required: true, displayOptions: showIssue },
      { displayName: 'Recipient Name', name: 'recipientName', type: 'string', default: '', displayOptions: showIssue },
      { displayName: 'Subject Type', name: 'subjectType', type: 'options', options: ['Product', 'Lot', 'Order', 'Shipment', 'Service'].map((name) => ({ name, value: name.toLowerCase() })), default: 'product', displayOptions: showIssue },
      { displayName: 'Subject ID', name: 'subjectId', type: 'string', default: '', required: true, displayOptions: showIssue },
      { displayName: 'Subject Name', name: 'subjectName', type: 'string', default: '', required: true, displayOptions: showIssue },
      { displayName: 'Requirement', name: 'requirement', type: 'string', typeOptions: { rows: 3 }, default: '', required: true, displayOptions: showIssue },
      { displayName: 'Evidence JSON', name: 'evidenceJson', type: 'json', default: '[{"label":"Workflow evidence","url":"https://example.invalid/evidence"}]', required: true, displayOptions: showIssue, description: 'Array of evidence entries. Each entry needs a label and may contain a SHA-256 or HTTPS URL.' },
      { displayName: 'Valid Until', name: 'validUntil', type: 'dateTime', default: '', required: true, displayOptions: showIssue },
      { displayName: 'External ID', name: 'externalId', type: 'string', default: '', displayOptions: showIssue },
      { displayName: 'Idempotency Key', name: 'idempotencyKey', type: 'string', default: '={{$execution.id + ":" + $itemIndex}}', required: true, displayOptions: showIssue, description: 'Use a stable business key when retries may run in a different execution.' },
      { displayName: 'GOVP Code', name: 'code', type: 'string', default: '', required: true, displayOptions: showCode },
      { displayName: 'Revocation Reason', name: 'reason', type: 'string', default: '', required: true, displayOptions: { show: { operation: ['revoke'] } } },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const input = this.getInputData();
    const credentials = await this.getCredentials('govpExchangeApi');
    const baseUrl = normalizeBaseUrl(String(credentials.baseUrl));
    const output: INodeExecutionData[] = [];

    for (let index = 0; index < input.length; index += 1) {
      try {
        const selected = this.getNodeParameter('operation', index) as 'issue' | 'verify' | 'revoke';
        let response: unknown;
        if (selected === 'issue') {
          const body = buildIssueBody({
            issuerName: this.getNodeParameter('issuerName', index) as string,
            recipientName: this.getNodeParameter('recipientName', index, '') as string,
            subjectType: this.getNodeParameter('subjectType', index) as 'product' | 'lot' | 'order' | 'shipment' | 'service',
            subjectId: this.getNodeParameter('subjectId', index) as string,
            subjectName: this.getNodeParameter('subjectName', index) as string,
            requirement: this.getNodeParameter('requirement', index) as string,
            evidenceJson: this.getNodeParameter('evidenceJson', index) as string,
            validUntil: this.getNodeParameter('validUntil', index) as string,
            externalId: this.getNodeParameter('externalId', index, '') as string,
          });
          response = await this.helpers.httpRequestWithAuthentication.call(this, 'govpExchangeApi', {
            method: 'POST', url: `${baseUrl}/connectors/issue`,
            headers: { 'Idempotency-Key': validateIdempotencyKey(this.getNodeParameter('idempotencyKey', index) as string) },
            body, json: true,
          });
        } else if (selected === 'verify') {
          const code = encodeURIComponent(this.getNodeParameter('code', index) as string);
          response = await this.helpers.httpRequestWithAuthentication.call(this, 'govpExchangeApi', { method: 'GET', url: `${baseUrl}/govps/${code}`, json: true });
        } else {
          const code = encodeURIComponent(this.getNodeParameter('code', index) as string);
          response = await this.helpers.httpRequestWithAuthentication.call(this, 'govpExchangeApi', {
            method: 'POST', url: `${baseUrl}/connectors/govps/${code}/revoke`,
            body: { reason: this.getNodeParameter('reason', index) as string }, json: true,
          });
        }
        output.push({ json: response as INodeExecutionData['json'], pairedItem: { item: index } });
      } catch (error) {
        if (this.continueOnFail()) output.push({ json: { error: error instanceof Error ? error.message : 'Unknown GOVP error' }, pairedItem: { item: index } });
        else throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: index });
      }
    }
    return [output];
  }
}
