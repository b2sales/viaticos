import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { SECRETS } from '../constants.js';
import {
  BOOTSTRAP_CAPABILITIES,
  EMPTY_CAPABILITIES,
  getEmployeeByEntraOid,
  getRoleById,
  ensureSeedRolesAndChains,
} from '../repos/index.js';
import type { Employee, Role, RoleCapabilities } from '../types/index.js';

export interface EntraConfig {
  tenantId: string;
  clientId: string;
  adminGroupId: string;
}

export interface VerifiedEntraUser {
  payload: JWTPayload;
  groups: string[];
  isAdmin: boolean;
}

export interface AdminUser {
  oid: string;
  name?: string;
  email?: string;
  groups: string[];
}

export interface AuthUser {
  oid: string;
  name?: string;
  email?: string;
  groups: string[];
  /** True when Entra Viaticos-Admins group membership grants full access. */
  isBootstrapAdmin: boolean;
  employee?: Employee;
  role?: Role;
  capabilities: RoleCapabilities;
}

export class AuthError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 401) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}

let cachedConfig: EntraConfig | undefined;
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export async function loadEntraConfig(secretName?: string): Promise<EntraConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
  });
  const response = await client.send(
    new GetSecretValueCommand({
      SecretId: secretName ?? process.env.ENTRA_SECRET_NAME ?? SECRETS.entraConfig,
    }),
  );

  if (!response.SecretString) {
    throw new Error('Entra config secret has no SecretString');
  }

  const parsed = JSON.parse(response.SecretString) as Partial<EntraConfig>;
  if (!parsed.tenantId || !parsed.clientId || !parsed.adminGroupId) {
    throw new Error('Entra config missing tenantId, clientId, or adminGroupId');
  }

  cachedConfig = {
    tenantId: parsed.tenantId,
    clientId: parsed.clientId,
    adminGroupId: parsed.adminGroupId,
  };
  return cachedConfig;
}

function extractGroups(payload: JWTPayload): string[] {
  const groups = payload.groups;
  if (Array.isArray(groups)) {
    return groups.filter((g): g is string => typeof g === 'string');
  }
  return [];
}

export async function verifyEntraJwt(token: string): Promise<VerifiedEntraUser> {
  const config = await loadEntraConfig();
  const issuer = `https://login.microsoftonline.com/${config.tenantId}/v2.0`;

  if (!cachedJwks) {
    cachedJwks = createRemoteJWKSet(
      new URL(
        `https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`,
      ),
    );
  }

  const { payload } = await jwtVerify(token, cachedJwks, {
    issuer,
    audience: config.clientId,
  });

  const groups = extractGroups(payload);
  const roles = Array.isArray(payload.roles)
    ? payload.roles.filter((r): r is string => typeof r === 'string')
    : [];
  const isAdmin =
    groups.includes(config.adminGroupId) || roles.includes('Admin');

  return { payload, groups, isAdmin };
}

function extractBearerToken(header: string | undefined): string {
  if (!header) {
    throw new AuthError('Missing Authorization header');
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    throw new AuthError('Invalid Authorization header');
  }
  return match[1];
}

function hasAnyWebCapability(caps: RoleCapabilities): boolean {
  return (
    caps.canApprove ||
    caps.canLiquidate ||
    caps.canManageMasters ||
    caps.canManageTeam ||
    caps.canConfigureRoles
  );
}

/**
 * Authenticate any panel user: Entra JWT + employee role capabilities,
 * or bootstrap via Viaticos-Admins group.
 */
export async function authenticatePanelUser(
  authorizationHeader: string | undefined,
  secretName?: string,
): Promise<AuthUser> {
  const token = extractBearerToken(authorizationHeader);
  await loadEntraConfig(secretName);
  await ensureSeedRolesAndChains();

  const verified = await verifyEntraJwt(token);
  const oid =
    typeof verified.payload.oid === 'string' ? verified.payload.oid : '';
  if (!oid) {
    throw new AuthError('Invalid token: missing oid');
  }

  const name =
    typeof verified.payload.name === 'string'
      ? verified.payload.name
      : undefined;
  const email =
    typeof verified.payload.preferred_username === 'string'
      ? verified.payload.preferred_username
      : typeof verified.payload.email === 'string'
        ? verified.payload.email
        : undefined;

  const employee = await getEmployeeByEntraOid(oid);
  let role: Role | undefined;
  let capabilities: RoleCapabilities = EMPTY_CAPABILITIES;

  if (employee?.active && employee.roleId) {
    role = await getRoleById(employee.roleId);
    if (role?.active) {
      capabilities = role.capabilities;
    }
  }

  const isBootstrapAdmin = verified.isAdmin;
  if (isBootstrapAdmin) {
    capabilities = { ...BOOTSTRAP_CAPABILITIES };
  }

  if (!isBootstrapAdmin && !hasAnyWebCapability(capabilities)) {
    throw new AuthError('Forbidden: no panel access for this user', 403);
  }

  return {
    oid,
    name,
    email,
    groups: verified.groups,
    isBootstrapAdmin,
    employee: employee?.active ? employee : undefined,
    role,
    capabilities,
  };
}

/** @deprecated Prefer authenticatePanelUser */
export async function verifyAdminBearerToken(
  authorizationHeader: string | undefined,
  secretName?: string,
): Promise<AdminUser> {
  const user = await authenticatePanelUser(authorizationHeader, secretName);
  if (!user.isBootstrapAdmin && !user.capabilities.canConfigureRoles) {
    throw new AuthError('Forbidden: admin group required', 403);
  }
  return {
    oid: user.oid,
    name: user.name,
    email: user.email,
    groups: user.groups,
  };
}
