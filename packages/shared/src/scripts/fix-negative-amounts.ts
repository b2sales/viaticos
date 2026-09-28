/**
 * One-shot: turn negative expense amounts positive and recalculate the totals
 * of the settlement batches that contain them.
 *
 * Usage (from repo root, with AWS_PROFILE=ecorp):
 *   npm run fix:negative-amounts
 */
import { putItem, scan } from '../dynamodb/helpers.js';
import { getExpenseById } from '../repos/expenses.js';
import {
  getSettlementBatchById,
  updateSettlementBatch,
} from '../repos/settlements.js';
import { TABLE_NAMES, type Expense } from '../types/index.js';

const negatives = await scan<Expense>({
  TableName: TABLE_NAMES.expenses,
  FilterExpression: 'amount < :zero',
  ExpressionAttributeValues: { ':zero': 0 },
});

const now = new Date().toISOString();
const batchIds = new Set<string>();

for (const expense of negatives) {
  const amount = Math.abs(expense.amount);
  await putItem({
    TableName: TABLE_NAMES.expenses,
    Item: { ...expense, amount, updatedAt: now },
  });
  if (expense.settlementBatchId) batchIds.add(expense.settlementBatchId);
  console.log(
    `${expense.folio ?? expense.id}: ${expense.amount} -> ${amount} ${expense.currency} (${expense.status})`,
  );
}

for (const batchId of batchIds) {
  const batch = await getSettlementBatchById(batchId);
  if (!batch) continue;
  const totals: Record<string, number> = {};
  for (const id of batch.expenseIds) {
    const e = await getExpenseById(id);
    if (!e) continue;
    const currency = e.currency || 'ARS';
    totals[currency] = Math.round(((totals[currency] ?? 0) + e.amount) * 100) / 100;
  }
  await updateSettlementBatch(batchId, { totalByCurrency: totals });
  console.log(
    `Lote ${batch.name ?? batchId}: ${JSON.stringify(batch.totalByCurrency)} -> ${JSON.stringify(totals)}`,
  );
}

console.log(`Gastos corregidos: ${negatives.length}. Lotes recalculados: ${batchIds.size}.`);
