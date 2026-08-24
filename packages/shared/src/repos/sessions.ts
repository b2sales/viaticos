import { getItem, putItem, updateItem } from '../dynamodb/helpers.js';
import { TABLE_NAMES, type BotSession, type BotSessionState } from '../types/index.js';

export async function getBotSession(telegramUserId: string): Promise<BotSession | undefined> {
  return getItem<BotSession>({
    TableName: TABLE_NAMES.botSessions,
    Key: { telegramUserId },
  });
}

export async function saveBotSession(session: BotSession): Promise<void> {
  await putItem({
    TableName: TABLE_NAMES.botSessions,
    Item: {
      ...session,
      updatedAt: new Date().toISOString(),
    },
  });
}

export async function updateBotSessionState(
  telegramUserId: string,
  state: BotSessionState,
  context?: Record<string, unknown>,
): Promise<BotSession> {
  const existing = await getBotSession(telegramUserId);
  const session: BotSession = {
    telegramUserId,
    technicianId: existing?.technicianId,
    state,
    context: context ?? existing?.context,
    updatedAt: new Date().toISOString(),
  };
  await saveBotSession(session);
  return session;
}

export async function clearBotSession(telegramUserId: string): Promise<void> {
  await updateItem({
    TableName: TABLE_NAMES.botSessions,
    Key: { telegramUserId },
    UpdateExpression: 'SET #state = :idle, #context = :empty, updatedAt = :now',
    ExpressionAttributeNames: { '#state': 'state', '#context': 'context' },
    ExpressionAttributeValues: {
      ':idle': 'IDLE',
      ':empty': {},
      ':now': new Date().toISOString(),
    },
  });
}
