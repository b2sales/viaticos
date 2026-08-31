import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { SECRETS } from '../constants.js';
import {
  ADMIN_PANEL_CAPABILITIES,
  EMPTY_CAPABILITIES,
  getRoleById,
  ensureSeedRolesAndChains,
  LIQUIDACION_PANEL_CAPABILITIES,
  SUPERVISOR_PANEL_CAPABILITIES,
} from '../repos/index.js';
import { SEED_ROLE_IDS, type Role, type RoleCapabilities } from '../types/index.js';

export interface EntraConfig {
  tenantId: string;
  clientId: string;
  clientSecret?: string;
  adminGroupId: string;
  supervisorGroupId?: string;
  liquidacionGroupId?: string;
}

export interface VerifiedEntraUser {
  payload: JWTPayload;
  groups: string[];
  isAdminGroup: boolean;
  isSupervisorGroup: boolean;
  isLiquidacionGroup: boolean;
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
  /** True when member of Viaticos-Admins (full panel access). */
  isBootstrapAdmin: boolean;
  /** Member of Viaticos-Supervisores (even if admin caps win). */
  isSupervisorGroupMember: boolean;
  /** Primary panel role for approval chains (admin > supervisor > liquidación). */
  panelRoleId?: string;
  panelRoleLabel?: string;
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
    clientSecret: parsed.clientSecret,
    adminGroupId: parsed.adminGroupId,
    supervisorGroupId: parsed.supervisorGroupId,
    liquidacionGroupId: parsed.liquidacionGroupId,
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

function resolveGroupMembership(
  groups: string[],
  config: EntraConfig,
  payload: JWTPayload,
): Pick<
  VerifiedEntraUser,
  'isAdminGroup' | 'isSupervisorGroup' | 'isLiquidacionGroup'
> {
  const roles = Array.isArray(payload.roles)
    ? payload.roles.filter((r): r is string => typeof r === 'string')
    : [];
  const isAdminGroup =
    groups.includes(config.adminGroupId) || roles.includes('Admin');
  const isSupervisorGroup = config.supervisorGroupId
    ? groups.includes(config.supervisorGroupId)
    : false;
  const isLiquidacionGroup = config.liquidacionGroupId
    ? groups.includes(config.liquidacionGroupId)
    : false;
  return { isAdminGroup, isSupervisorGroup, isLiquidacionGroup };
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
  const membership = resolveGroupMembership(groups, config, payload);

  return { payload, groups, ...membership };
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

function resolvePanelAccess(membership: Pick<
  VerifiedEntraUser,
  'isAdminGroup' | 'isSupervisorGroup' | 'isLiquidacionGroup'
>): {
  capabilities: RoleCapabilities;
  panelRoleId?: string;
  panelRoleLabel?: string;
  isBootstrapAdmin: boolean;
} {
  if (membership.isAdminGroup) {
    return {
      capabilities: { ...ADMIN_PANEL_CAPABILITIES },
      panelRoleId: SEED_ROLE_IDS.admin,
      panelRoleLabel: 'Admin general',
      isBootstrapAdmin: true,
    };
  }
  if (membership.isSupervisorGroup) {
    return {
      capabilities: { ...SUPERVISOR_PANEL_CAPABILITIES },
      panelRoleId: SEED_ROLE_IDS.supervisor,
      panelRoleLabel: 'Supervisor',
      isBootstrapAdmin: false,
    };
  }
  if (membership.isLiquidacionGroup) {
    return {
      capabilities: { ...LIQUIDACION_PANEL_CAPABILITIES },
      panelRoleId: SEED_ROLE_IDS.liquidacion,
      panelRoleLabel: 'Liquidación',
      isBootstrapAdmin: false,
    };
  }
  return {
    capabilities: { ...EMPTY_CAPABILITIES },
    isBootstrapAdmin: false,
  };
}

/**
 * Authenticate panel user via Entra JWT group membership (Admins / Supervisores / Liquidación).
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

  const access = resolvePanelAccess(verified);

  if (!hasAnyWebCapability(access.capabilities)) {
    throw new AuthError('Forbidden: no panel access for this user', 403);
  }

  let panelRoleLabel = access.panelRoleLabel;
  if (access.isBootstrapAdmin && verified.isSupervisorGroup) {
    panelRoleLabel = 'Admin general (también supervisor)';
  }

  const role = access.panelRoleId
    ? await getRoleById(access.panelRoleId)
    : undefined;

  return {
    oid,
    name,
    email,
    groups: verified.groups,
    isBootstrapAdmin: access.isBootstrapAdmin,
    isSupervisorGroupMember: verified.isSupervisorGroup,
    panelRoleId: access.panelRoleId,
    panelRoleLabel,
    role: role?.active ? role : undefined,
    capabilities: access.capabilities,
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
