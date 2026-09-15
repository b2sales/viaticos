import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TIMEZONE } from '../constants.js';
import {
  deleteItem,
  generateId,
  getDocClient,
  getItem,
  putItem,
  query,
  scan,
} from '../dynamodb/helpers.js';
import {
  GSI_NAMES,
  TABLE_NAMES,
  type Expense,
  type ExpenseStatus,
} from '../types/index.js';
import { nextExpenseFolio } from './counters.js';

export function getMonthKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${year}-${month}`;
}

export function getMonthBounds(monthKey?: string): { start: string; end: string; monthKey: string } {
  const key = monthKey ?? getMonthKey();
  const [yearStr, monthStr] = key.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);

  const startLocal = new Date(`${yearStr}-${monthStr}-01T00:00:00-03:00`);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endLocal = new Date(
    `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01T00:00:00-03:00`,
  );

  return {
    monthKey: key,
    start: startLocal.toISOString(),
    end: endLocal.toISOString(),
  };
}

export async function listExpensesByTechnicianAndMonth(
  technicianId: string,
  monthKey?: string,
): Promise<Expense[]> {
  const { start, end } = getMonthBounds(monthKey);

  const byIndex = await query<Expense>({
    TableName: TABLE_NAMES.expenses,
    IndexName: GSI_NAMES.expensesByTechnicianMonth,
    KeyConditionExpression: 'technicianId = :technicianId AND submittedAt BETWEEN :start AND :end',
    ExpressionAttributeValues: {
      ':technicianId': technicianId,
      ':start': start,
      ':end': end,
    },
  });

  if (byIndex.length > 0) {
    return byIndex.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }

  const all = await scan<Expense>({
    TableName: TABLE_NAMES.expenses,
    FilterExpression:
      'technicianId = :technicianId AND submittedAt >= :start AND submittedAt < :end',
    ExpressionAttributeValues: {
      ':technicianId': technicianId,
      ':start': start,
      ':end': end,
    },
  });
  return all.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

export async function listExpensesByStatus(status: ExpenseStatus): Promise<Expense[]> {
  return query<Expense>({
    TableName: TABLE_NAMES.expenses,
    IndexName: GSI_NAMES.expensesByStatus,
    KeyConditionExpression: '#status = :status',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':status': status },
  });
}

export async function getExpenseById(id: string): Promise<Expense | undefined> {
  return getItem<Expense>({
    TableName: TABLE_NAMES.expenses,
    Key: { id },
  });
}

/** True if the technician has at least one expense (any month). */
export async function hasExpensesByTechnician(
  technicianId: string,
): Promise<boolean> {
  const result = await getDocClient().send(
    new QueryCommand({
      TableName: TABLE_NAMES.expenses,
      IndexName: GSI_NAMES.expensesByTechnicianMonth,
      KeyConditionExpression: 'technicianId = :technicianId',
      ExpressionAttributeValues: { ':technicianId': technicianId },
      Limit: 1,
      Select: 'COUNT',
    }),
  );
  return (result.Count ?? 0) > 0;
}

export async function createExpense(
  input: Omit<Expense, 'id' | 'folio' | 'createdAt' | 'updatedAt'>,
): Promise<Expense> {
  const now = new Date().toISOString();
  const folio = await nextExpenseFolio();
  const expense: Expense = {
    ...input,
    id: generateId(),
    folio,
    createdAt: now,
    updatedAt: now,
  };
  await putItem({
    TableName: TABLE_NAMES.expenses,
    Item: expense,
  });
  return expense;
}

export async function deleteExpense(id: string): Promise<void> {
  await deleteItem({
    TableName: TABLE_NAMES.expenses,
    Key: { id },
  });
}

export async function updateExpense(
  id: string,
  updates: Partial<Omit<Expense, 'id' | 'createdAt'>>,
): Promise<Expense | undefined> {
  const existing = await getExpenseById(id);
  if (!existing) {
    return undefined;
  }

  const updated: Expense = {
    ...existing,
    ...updates,
    id,
    updatedAt: new Date().toISOString(),
  };

  await putItem({
    TableName: TABLE_NAMES.expenses,
    Item: updated,
  });
  return updated;
}
