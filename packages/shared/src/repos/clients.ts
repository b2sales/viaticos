import { getItem, scan } from '../dynamodb/helpers.js';
import { TABLE_NAMES, type Client } from '../types/index.js';

export async function listActiveClients(): Promise<Client[]> {
  const items = await scan<Client>({
    TableName: TABLE_NAMES.clients,
    FilterExpression: '#active = :active',
    ExpressionAttributeNames: { '#active': 'active' },
    ExpressionAttributeValues: { ':active': true },
  });
  return items.sort((a, b) => a.name.localeCompare(b.name, 'es-AR'));
}

export async function getClientById(id: string): Promise<Client | undefined> {
  return getItem<Client>({
    TableName: TABLE_NAMES.clients,
    Key: { id },
  });
}
