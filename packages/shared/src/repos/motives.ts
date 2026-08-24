import { getItem, scan } from '../dynamodb/helpers.js';
import { TABLE_NAMES, type ExpenseMotive } from '../types/index.js';

export async function listActiveMotives(): Promise<ExpenseMotive[]> {
  const items = await scan<ExpenseMotive>({
    TableName: TABLE_NAMES.expenseMotives,
    FilterExpression: '#active = :active',
    ExpressionAttributeNames: { '#active': 'active' },
    ExpressionAttributeValues: { ':active': true },
  });
  return items.sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'es-AR'),
  );
}

export async function listMotives(): Promise<ExpenseMotive[]> {
  const items = await scan<ExpenseMotive>({
    TableName: TABLE_NAMES.expenseMotives,
  });
  return items.sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'es-AR'),
  );
}

export async function getMotiveById(id: string): Promise<ExpenseMotive | undefined> {
  return getItem<ExpenseMotive>({
    TableName: TABLE_NAMES.expenseMotives,
    Key: { id },
  });
}
