import { generateId, getItem, putItem, scan } from '../dynamodb/helpers.js';
import {
  TABLE_NAMES,
  type SettlementBatch,
  type SettlementBatchStatus,
} from '../types/index.js';

export async function getSettlementBatchById(
  id: string,
): Promise<SettlementBatch | undefined> {
  return getItem<SettlementBatch>({
    TableName: TABLE_NAMES.settlementBatches,
    Key: { id },
  });
}

export async function listSettlementBatches(
  status?: SettlementBatchStatus,
): Promise<SettlementBatch[]> {
  const items = await scan<SettlementBatch>({
    TableName: TABLE_NAMES.settlementBatches,
  });
  const filtered = status ? items.filter((b) => b.status === status) : items;
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createSettlementBatch(
  input: Omit<SettlementBatch, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<SettlementBatch> {
  const now = new Date().toISOString();
  const batch: SettlementBatch = {
    ...input,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
  await putItem({ TableName: TABLE_NAMES.settlementBatches, Item: batch });
  return batch;
}

export async function updateSettlementBatch(
  id: string,
  updates: Partial<Omit<SettlementBatch, 'id' | 'createdAt'>>,
): Promise<SettlementBatch | undefined> {
  const existing = await getSettlementBatchById(id);
  if (!existing) return undefined;
  const updated: SettlementBatch = {
    ...existing,
    ...updates,
    id,
    updatedAt: new Date().toISOString(),
  };
  await putItem({ TableName: TABLE_NAMES.settlementBatches, Item: updated });
  return updated;
}
