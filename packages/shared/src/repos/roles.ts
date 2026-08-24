import { generateId, getItem, putItem, scan } from '../dynamodb/helpers.js';
import {
  TABLE_NAMES,
  type Role,
  type RoleCapabilities,
} from '../types/index.js';

export async function getRoleById(id: string): Promise<Role | undefined> {
  return getItem<Role>({
    TableName: TABLE_NAMES.roles,
    Key: { id },
  });
}

export async function listRoles(): Promise<Role[]> {
  return scan<Role>({ TableName: TABLE_NAMES.roles });
}

export async function createRole(
  input: Omit<Role, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): Promise<Role> {
  const now = new Date().toISOString();
  const role: Role = {
    id: input.id ?? generateId(),
    name: input.name,
    active: input.active,
    capabilities: input.capabilities,
    createdAt: now,
    updatedAt: now,
  };
  await putItem({ TableName: TABLE_NAMES.roles, Item: role });
  return role;
}

export async function updateRole(
  id: string,
  updates: Partial<Omit<Role, 'id' | 'createdAt'>>,
): Promise<Role | undefined> {
  const existing = await getRoleById(id);
  if (!existing) return undefined;
  const updated: Role = {
    ...existing,
    ...updates,
    id,
    capabilities: updates.capabilities ?? existing.capabilities,
    updatedAt: new Date().toISOString(),
  };
  await putItem({ TableName: TABLE_NAMES.roles, Item: updated });
  return updated;
}

export function allCapabilities(value: boolean): RoleCapabilities {
  return {
    canApprove: value,
    canLiquidate: value,
    canManageMasters: value,
    canManageTeam: value,
    canConfigureRoles: value,
  };
}

export const EMPTY_CAPABILITIES: RoleCapabilities = allCapabilities(false);

export const BOOTSTRAP_CAPABILITIES: RoleCapabilities = allCapabilities(true);
