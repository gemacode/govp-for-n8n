import type {
  IDataObject, IHookFunctions, IWebhookFunctions, IWebhookResponseData, INodeType, INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { normalizeBaseUrl } from './shared.js';
import { registerWebhookEvent, verifyWebhookEnvelope, webhookEventTypes, type SignedWebhookEnvelope, type WebhookEventType } from './webhooks.js';

type WebhookList = { webhooks: Array<{ id: string; status: string }> };

function rejectWebhook(context: IWebhookFunctions, status: number, message: string): IWebhookResponseData {
  context.getResponseObject().status(status).send(message).end();
  return { noWebhookResponse: true };
}

export class GovpTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'GOVP Trigger',
    name: 'govpTrigger',
    icon: 'fa:certificate',
    group: ['trigger'],
    version: 1,
    description: 'Starts the workflow when a signed GOVP Exchange event occurs',
    defaults: { name: 'GOVP Trigger' },
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'govpExchangeApi', required: true }],
    webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' }],
    properties: [{
      displayName: 'Events', name: 'events', type: 'multiOptions', required: true,
      options: webhookEventTypes.map((value) => ({ name: value, value })),
      default: ['govp.issued'], description: 'Signed Exchange events that activate this workflow.',
    }],
  };

  webhookMethods = { default: {
    async checkExists(this: IHookFunctions): Promise<boolean> {
      const data = this.getWorkflowStaticData('node');
      if (!data.webhookId) return false;
      const credentials = await this.getCredentials('govpExchangeApi');
      const response = await this.helpers.httpRequestWithAuthentication.call(this, 'govpExchangeApi', {
        method: 'GET', url: `${normalizeBaseUrl(String(credentials.baseUrl))}/connectors/webhooks`, json: true,
      }) as WebhookList;
      const exists = response.webhooks.some((item) => item.id === data.webhookId && item.status === 'active');
      if (!exists) delete data.webhookId;
      return exists;
    },
    async create(this: IHookFunctions): Promise<boolean> {
      const callbackUrl = this.getNodeWebhookUrl('default') as string;
      if (!callbackUrl.startsWith('https://')) throw new NodeOperationError(this.getNode(), 'GOVP Trigger necesita una URL webhook HTTPS pública.');
      const credentials = await this.getCredentials('govpExchangeApi');
      const response = await this.helpers.httpRequestWithAuthentication.call(this, 'govpExchangeApi', {
        method: 'POST', url: `${normalizeBaseUrl(String(credentials.baseUrl))}/connectors/webhooks`, json: true,
        body: { url: callbackUrl, events: this.getNodeParameter('events') as WebhookEventType[] },
      }) as { webhook: { id: string }; verification: { keyUrl: string } };
      const data = this.getWorkflowStaticData('node');
      data.webhookId = response.webhook.id;
      data.keyUrl = response.verification.keyUrl;
      return true;
    },
    async delete(this: IHookFunctions): Promise<boolean> {
      const data = this.getWorkflowStaticData('node');
      if (!data.webhookId) return true;
      const credentials = await this.getCredentials('govpExchangeApi');
      try {
        await this.helpers.httpRequestWithAuthentication.call(this, 'govpExchangeApi', {
          method: 'DELETE', url: `${normalizeBaseUrl(String(credentials.baseUrl))}/connectors/webhooks/${encodeURIComponent(String(data.webhookId))}`, json: true,
        });
      } catch { return false; }
      delete data.webhookId; delete data.keyUrl; delete data.seenEventIds;
      return true;
    },
  } };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const envelope = this.getBodyData() as SignedWebhookEnvelope;
    const credentials = await this.getCredentials('govpExchangeApi');
    const baseUrl = normalizeBaseUrl(String(credentials.baseUrl));
    const keyId = envelope?.signature?.keyId;
    if (!keyId) return rejectWebhook(this, 401, 'Missing GOVP signature');
    const trusted = await this.helpers.httpRequestWithAuthentication.call(this, 'govpExchangeApi', {
      method: 'GET', url: `${baseUrl}/keys/${encodeURIComponent(keyId)}`, json: true,
    }) as { key: { status: string; publicJwk: JsonWebKey } };
    if (!['active', 'retired'].includes(trusted.key.status)
      || !await verifyWebhookEnvelope(envelope, trusted.key.publicJwk)) return rejectWebhook(this, 401, 'Invalid GOVP signature');
    const data = this.getWorkflowStaticData('node');
    const seen = Array.isArray(data.seenEventIds) ? data.seenEventIds as string[] : [];
    if (seen.includes(envelope.event.id)
      || !registerWebhookEvent(`${baseUrl}\u0000${envelope.event.id}`)) return rejectWebhook(this, 409, 'Repeated GOVP event');
    data.seenEventIds = [...seen.slice(-499), envelope.event.id];
    return { workflowData: [this.helpers.returnJsonArray([{ event: envelope.event, signature: envelope.signature } as IDataObject])] };
  }

}
