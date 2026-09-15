import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  getDocClient,
  getItem,
  putItem,
  scan,
} from '../dynamodb/helpers.js';
import { TABLE_NAMES, type Expense } from '../types/index.js';

export const COUNTER_EXPENSE_FOLIO = 'expense-folio';

export function formatExpenseFolio(n: number): string {
  return `V-${String(n).padStart(6, '0')}`;
}

export function parseExpenseFolio(folio: string): number | undefined {
  const m = /^V-(\d+)$/i.exec(folio.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/** Atomically increments the expense folio counter and returns the formatted folio. */
export async function nextExpenseFolio(): Promise<string> {
  const result = await getDocClient().send(
    new UpdateCommand({
      TableName: TABLE_NAMES.counters,
      Key: { name: COUNTER_EXPENSE_FOLIO },
      UpdateExpression: 'ADD #v :one',
      ExpressionAttributeNames: { '#v': 'value' },
      ExpressionAttributeValues: { ':one': 1 },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
  const n = Number(result.Attributes?.value ?? 0);
  return formatExpenseFolio(n);
}

async function ensureExpenseFolioCounterAtLeast(min: number): Promise<void> {
  if (min <= 0) return;
  const existing = await getItem<{ name: string; value: number }>({
    TableName: TABLE_NAMES.counters,
    Key: { name: COUNTER_EXPENSE_FOLIO },
  });
  const current = existing?.value ?? 0;
  if (current >= min) return;
  await putItem({
    TableName: TABLE_NAMES.counters,
    Item: { name: COUNTER_EXPENSE_FOLIO, value: min },
  });
}

/**
 * Assigns folios to expenses that lack one, ordered by submittedAt.
 * Syncs the counter to the max existing folio first.
 */
export async function backfillExpenseFolios(): Promise<{ assigned: number }> {
  const all = await scan<Expense>({ TableName: TABLE_NAMES.expenses });
  let maxN = 0;
  for (const e of all) {
    if (!e.folio) continue;
    const n = parseExpenseFolio(e.folio);
    if (n != null) maxN = Math.max(maxN, n);
  }
  await ensureExpenseFolioCounterAtLeast(maxN);

  const missing = all
    .filter((e) => !e.folio)
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));

  const now = new Date().toISOString();
  for (const expense of missing) {
    const folio = await nextExpenseFolio();
    await putItem({
      TableName: TABLE_NAMES.expenses,
      Item: { ...expense, folio, updatedAt: now },
    });
  }

  return { assigned: missing.length };
}
