import { getItem, scan } from '../dynamodb/helpers.js';
import { TABLE_NAMES, type Location } from '../types/index.js';

export async function listActiveLocations(): Promise<Location[]> {
  const items = await scan<Location>({
    TableName: TABLE_NAMES.locations,
    FilterExpression: '#active = :active',
    ExpressionAttributeNames: { '#active': 'active' },
    ExpressionAttributeValues: { ':active': true },
  });
  return items.sort((a, b) => a.name.localeCompare(b.name, 'es-AR'));
}

export async function listLocations(): Promise<Location[]> {
  const items = await scan<Location>({
    TableName: TABLE_NAMES.locations,
  });
  return items.sort((a, b) => a.name.localeCompare(b.name, 'es-AR'));
}

export async function getLocationById(id: string): Promise<Location | undefined> {
  return getItem<Location>({
    TableName: TABLE_NAMES.locations,
    Key: { id },
  });
}
