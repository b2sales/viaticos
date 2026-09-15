import {
  deleteItem,
  generateId,
  putItem,
  query,
  scan,
} from '../dynamodb/helpers.js';
import { GSI_NAMES, TABLE_NAMES, type ExpenseMessage } from '../types/index.js';

export async function listMessagesByExpenseId(expenseId: string): Promise<ExpenseMessage[]> {
  const byIndex = await query<ExpenseMessage>({
    TableName: TABLE_NAMES.expenseMessages,
    IndexName: GSI_NAMES.expenseMessagesByExpenseId,
    KeyConditionExpression: 'expenseId = :expenseId',
    ExpressionAttributeValues: { ':expenseId': expenseId },
  });

  if (byIndex.length > 0) {
    return byIndex.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  const all = await scan<ExpenseMessage>({
    TableName: TABLE_NAMES.expenseMessages,
    FilterExpression: 'expenseId = :expenseId',
    ExpressionAttributeValues: { ':expenseId': expenseId },
  });
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function createExpenseMessage(
  input: Omit<ExpenseMessage, 'id' | 'createdAt'>,
): Promise<ExpenseMessage> {
  const message: ExpenseMessage = {
    ...input,
    id: generateId(),
    createdAt: new Date().toISOString(),
  };
  await putItem({
    TableName: TABLE_NAMES.expenseMessages,
    Item: message,
  });
  return message;
}

export async function deleteExpenseMessage(id: string): Promise<void> {
  await deleteItem({
    TableName: TABLE_NAMES.expenseMessages,
    Key: { id },
  });
}

export async function deleteMessagesByExpenseId(
  expenseId: string,
): Promise<number> {
  const messages = await listMessagesByExpenseId(expenseId);
  await Promise.all(messages.map((m) => deleteExpenseMessage(m.id)));
  return messages.length;
}
