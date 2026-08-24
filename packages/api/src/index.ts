import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { handleAdminApi } from './handler.js';

export const handler: APIGatewayProxyHandlerV2 = handleAdminApi;
