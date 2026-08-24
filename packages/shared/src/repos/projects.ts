import { getItem, query, scan } from '../dynamodb/helpers.js';
import { GSI_NAMES, TABLE_NAMES, type Project } from '../types/index.js';

export async function listProjectsByClientId(clientId: string): Promise<Project[]> {
  const byIndex = await query<Project>({
    TableName: TABLE_NAMES.projects,
    IndexName: GSI_NAMES.projectsByClientId,
    KeyConditionExpression: 'clientId = :clientId',
    ExpressionAttributeValues: { ':clientId': clientId },
  });

  if (byIndex.length > 0) {
    return byIndex.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name, 'es-AR'));
  }

  const all = await scan<Project>({
    TableName: TABLE_NAMES.projects,
    FilterExpression: 'clientId = :clientId AND #active = :active',
    ExpressionAttributeNames: { '#active': 'active' },
    ExpressionAttributeValues: { ':clientId': clientId, ':active': true },
  });
  return all.sort((a, b) => a.name.localeCompare(b.name, 'es-AR'));
}

export async function getProjectById(id: string): Promise<Project | undefined> {
  return getItem<Project>({
    TableName: TABLE_NAMES.projects,
    Key: { id },
  });
}
