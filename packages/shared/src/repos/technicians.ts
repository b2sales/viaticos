import {
  deleteItem,
  getItem,
  putItem,
  query,
  scan,
  updateItem,
} from '../dynamodb/helpers.js';
import {
  GSI_NAMES,
  TABLE_NAMES,
  SEED_ROLE_IDS,
  type Employee,
  type Technician,
} from '../types/index.js';

export type { Employee, Technician };

const LINK_CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const TELEGRAM_LINK_CODE_REGEX = /^[a-z0-9]{6}$/;

export function isValidTelegramLinkCode(code: string): boolean {
  return TELEGRAM_LINK_CODE_REGEX.test(code);
}

export function normalizeTelegramLinkCode(input: string): string {
  return input.trim().toLowerCase();
}

function randomLinkCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += LINK_CODE_ALPHABET[bytes[i]! % LINK_CODE_ALPHABET.length];
  }
  return code;
}

export async function generateUniqueTelegramLinkCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomLinkCode();
    const existing = await getEmployeeByLinkCode(code);
    if (!existing) return code;
  }
  throw new Error('Failed to generate unique Telegram link code');
}

export async function getEmployeeById(id: string): Promise<Employee | undefined> {
  return getItem<Employee>({
    TableName: TABLE_NAMES.technicians,
    Key: { id },
  });
}

/** @deprecated Use getEmployeeById */
export const getTechnicianById = getEmployeeById;

export async function getEmployeeByTelegramUserId(
  telegramUserId: string,
): Promise<Employee | undefined> {
  const byIndex = await query<Employee>({
    TableName: TABLE_NAMES.technicians,
    IndexName: GSI_NAMES.techniciansByTelegramUserId,
    KeyConditionExpression: 'telegramUserId = :telegramUserId',
    ExpressionAttributeValues: { ':telegramUserId': telegramUserId },
    Limit: 1,
  });

  if (byIndex[0]) {
    return byIndex[0];
  }

  const all = await scan<Employee>({
    TableName: TABLE_NAMES.technicians,
    FilterExpression: 'telegramUserId = :telegramUserId',
    ExpressionAttributeValues: { ':telegramUserId': telegramUserId },
    Limit: 1,
  });
  return all[0];
}

/** @deprecated Use getEmployeeByTelegramUserId */
export const getTechnicianByTelegramUserId = getEmployeeByTelegramUserId;

export async function getEmployeeByLinkCode(
  code: string,
): Promise<Employee | undefined> {
  const normalized = normalizeTelegramLinkCode(code);
  if (!isValidTelegramLinkCode(normalized)) return undefined;

  try {
    const byIndex = await query<Employee>({
      TableName: TABLE_NAMES.technicians,
      IndexName: GSI_NAMES.techniciansByLinkCode,
      KeyConditionExpression: 'telegramLinkCode = :telegramLinkCode',
      ExpressionAttributeValues: { ':telegramLinkCode': normalized },
      Limit: 1,
    });
    if (byIndex[0]) return byIndex[0];
  } catch {
    // GSI may not exist yet before deploy
  }

  const all = await scan<Employee>({
    TableName: TABLE_NAMES.technicians,
    FilterExpression: 'telegramLinkCode = :telegramLinkCode',
    ExpressionAttributeValues: { ':telegramLinkCode': normalized },
    Limit: 1,
  });
  return all[0];
}

export async function getEmployeeByEntraOid(
  entraOid: string,
): Promise<Employee | undefined> {
  try {
    const byIndex = await query<Employee>({
      TableName: TABLE_NAMES.technicians,
      IndexName: GSI_NAMES.techniciansByEntraOid,
      KeyConditionExpression: 'entraOid = :entraOid',
      ExpressionAttributeValues: { ':entraOid': entraOid },
      Limit: 1,
    });
    if (byIndex[0]) return byIndex[0];
  } catch {
    // GSI may not exist yet before deploy
  }

  const all = await scan<Employee>({
    TableName: TABLE_NAMES.technicians,
    FilterExpression: 'entraOid = :entraOid',
    ExpressionAttributeValues: { ':entraOid': entraOid },
    Limit: 1,
  });
  return all[0];
}

export async function listEmployeesByManagerId(
  managerId: string,
): Promise<Employee[]> {
  try {
    return await query<Employee>({
      TableName: TABLE_NAMES.technicians,
      IndexName: GSI_NAMES.techniciansByManagerId,
      KeyConditionExpression: 'managerId = :managerId',
      ExpressionAttributeValues: { ':managerId': managerId },
    });
  } catch {
    return scan<Employee>({
      TableName: TABLE_NAMES.technicians,
      FilterExpression: 'managerId = :managerId',
      ExpressionAttributeValues: { ':managerId': managerId },
    });
  }
}

export async function listEmployeesByManagerEntraOid(
  managerEntraOid: string,
): Promise<Employee[]> {
  try {
    return await query<Employee>({
      TableName: TABLE_NAMES.technicians,
      IndexName: GSI_NAMES.techniciansByManagerEntraOid,
      KeyConditionExpression: 'managerEntraOid = :managerEntraOid',
      ExpressionAttributeValues: { ':managerEntraOid': managerEntraOid },
    });
  } catch {
    return scan<Employee>({
      TableName: TABLE_NAMES.technicians,
      FilterExpression: 'managerEntraOid = :managerEntraOid',
      ExpressionAttributeValues: { ':managerEntraOid': managerEntraOid },
    });
  }
}

export async function listTechnicians(): Promise<Employee[]> {
  const all = await listEmployees();
  return all.filter(
    (e) => e.roleId === SEED_ROLE_IDS.tecnico || !e.roleId,
  );
}

export async function listEmployees(): Promise<Employee[]> {
  return scan<Employee>({ TableName: TABLE_NAMES.technicians });
}

export async function putEmployee(employee: Employee): Promise<void> {
  await putItem({ TableName: TABLE_NAMES.technicians, Item: employee });
}

export async function deleteEmployee(id: string): Promise<void> {
  await deleteItem({ TableName: TABLE_NAMES.technicians, Key: { id } });
}

export class TelegramLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelegramLinkError';
  }
}

export async function linkEmployeeTelegram(
  employeeId: string,
  telegramUserId: string,
): Promise<Employee> {
  const employee = await getEmployeeById(employeeId);
  if (!employee) throw new TelegramLinkError('Empleado no encontrado');
  if (!employee.active) throw new TelegramLinkError('Empleado inactivo');
  if (employee.telegramUserId) throw new TelegramLinkError('Empleado ya vinculado');
  if (!employee.telegramLinkCode) {
    throw new TelegramLinkError('Sin código de vinculación');
  }

  const other = await getEmployeeByTelegramUserId(telegramUserId);
  if (other && other.id !== employeeId && other.active) {
    throw new TelegramLinkError('Telegram ya vinculado a otro empleado');
  }

  const ts = new Date().toISOString();
  await updateItem({
    TableName: TABLE_NAMES.technicians,
    Key: { id: employeeId },
    UpdateExpression:
      'SET telegramUserId = :telegramUserId, updatedAt = :updatedAt REMOVE telegramLinkCode',
    ExpressionAttributeValues: {
      ':telegramUserId': telegramUserId,
      ':updatedAt': ts,
    },
  });

  const updated = await getEmployeeById(employeeId);
  if (!updated) throw new TelegramLinkError('Empleado no encontrado');
  return updated;
}

export async function regenerateEmployeeLinkCode(
  employeeId: string,
): Promise<string> {
  const employee = await getEmployeeById(employeeId);
  if (!employee) throw new TelegramLinkError('Empleado no encontrado');
  if (employee.telegramUserId) {
    throw new TelegramLinkError('Empleado ya vinculado a Telegram');
  }

  const code = await generateUniqueTelegramLinkCode();
  const ts = new Date().toISOString();
  await updateItem({
    TableName: TABLE_NAMES.technicians,
    Key: { id: employeeId },
    UpdateExpression: 'SET telegramLinkCode = :code, updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':code': code,
      ':updatedAt': ts,
    },
  });
  return code;
}
