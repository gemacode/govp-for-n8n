import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class GovpExchangeApi implements ICredentialType {
  name = 'govpExchangeApi';
  displayName = 'GOVP Exchange API';
  documentationUrl = 'https://github.com/gemacode/govp-for-n8n#credentials';
  properties: INodeProperties[] = [
    {
      displayName: 'Exchange URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://partners.gemacode.org/api/exchange',
      required: true,
    },
    {
      displayName: 'Connector Token',
      name: 'token',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
    },
  ];
  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.token}}',
        Accept: 'application/json',
      },
    },
  };
  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}',
      url: '/connectors/me',
    },
  };
}
