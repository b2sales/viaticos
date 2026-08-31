import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import {
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import {
  DOMAIN,
  GSI_NAMES,
  SEED_ROLE_IDS,
  TABLE_NAMES,
  TelegramClient,
  addTicketFollowup,
  authenticatePanelUser,
  createExpenseMessage,
  createSettlementBatch,
  ensureSeedRolesAndChains,
  generateId,
  generateUniqueTelegramLinkCode,
  getApprovalChain,
  getEmployeeById,
  getExpenseById,
  getClientById,
  getLocationById,
  getMotiveById,
  getItem,
  getRoleById,
  getSettlementBatchById,
  getTicket,
  glpiUiBaseUrl,
  listApprovalChains,
  listEmployees,
  listEmployeesByManagerEntraOid,
  listSupervisorGroupMembers,
  listTechnicians,
  listExpensesByStatus,
  listMessagesByExpenseId,
  listRoles,
  listSettlementBatches,
  loadGlpiConfig,
  putEmployee,
  putItem,
  query,
  regenerateEmployeeLinkCode,
  scan,
  searchTickets,
  updateExpense,
  updateSettlementBatch,
  upsertApprovalChain,
  createRole,
  updateRole,
  expensesToBandejaCsv,
  expensesToBandejaXlsx,
  listLocations,
  listMotives,
  type ApprovalChainStep,
  type AuthUser,
  type Client,
  type ClientKind,
  type Employee,
  type Expense,
  type ExpenseMotive,
  type ExpenseStatus,
  type Location,
  type Project,
  type Role,
  type RoleCapabilities,
  TelegramLinkError,
} from '@viaticos/shared';

const ALLOWED_ORIGINS = [`http://localhost:5173`, `https://${DOMAIN}`];
const JSON_CT = 'application/json';
const RECEIPTS_BUCKET = process.env.RECEIPTS_BUCKET ?? '';
const TELEGRAM_SECRET_NAME = process.env.TELEGRAM_SECRET_NAME ?? '';

function normalizeTelegramUserId(
  value: string | undefined,
): string | undefined {
  if (value == null || value.trim() === '') return undefined;
  const trimmed = value.trim().replace(/^@/, '');
  if (!/^\d+$/.test(trimmed)) return undefined;
  return trimmed;
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

let telegramToken: string | undefined;

function normalizePath(rawPath: string): string {
  const stripped = rawPath.replace(/^\/api(?=\/|$)/, '');
  return stripped || '/';
}

function corsHeaders(origin: string | undefined): Record<string, string> {
  const allowed =
    origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
    'Content-Type': JSON_CT,
  };
}

function jsonResponse(
  statusCode: number,
  body: unknown,
  origin: string | undefined,
  extraHeaders?: Record<string, string>,
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { ...corsHeaders(origin), ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function textResponse(
  statusCode: number,
  body: string,
  origin: string | undefined,
  contentType: string,
): APIGatewayProxyResultV2 {
  const headers = corsHeaders(origin);
  headers['Content-Type'] = contentType;
  return { statusCode, headers, body };
}

function binaryResponse(
  statusCode: number,
  body: Buffer,
  origin: string | undefined,
  contentType: string,
  filename?: string,
): APIGatewayProxyResultV2 {
  const headers = corsHeaders(origin);
  headers['Content-Type'] = contentType;
  if (filename) {
    headers['Content-Disposition'] = `attachment; filename="${filename}"`;
  }
  return {
    statusCode,
    headers,
    body: body.toString('base64'),
    isBase64Encoded: true,
  };
}

function parseBody<T>(event: APIGatewayProxyEventV2): T {
  return JSON.parse(event.body ?? '{}') as T;
}

function nowIso(): string {
  return new Date().toISOString();
}

function matchPath(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i];
    if (part.startsWith('{') && part.endsWith('}')) {
      params[part.slice(1, -1)] = decodeURIComponent(pathParts[i]);
    } else if (part !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

function requireCap(
  user: AuthUser,
  cap: keyof RoleCapabilities,
): void {
  if (!user.capabilities[cap]) {
    throw new HttpError(403, `Forbidden: ${cap} required`);
  }
}

function actorId(user: AuthUser): string {
  return user.oid;
}

interface ExpenseUpdateBody {
  amount?: number;
  currency?: string;
  merchant?: string;
  receiptDate?: string;
  motiveId?: string;
  locationId?: string;
  clientId?: string;
  glpiTicketId?: number | null;
}

async function buildExpenseAuditLines(
  before: Expense,
  after: Expense,
): Promise<string[]> {
  const lines: string[] = [];
  if (before.amount !== after.amount || before.currency !== after.currency) {
    lines.push(
      `monto ${before.amount} ${before.currency} → ${after.amount} ${after.currency}`,
    );
  }
  if ((before.merchant ?? '') !== (after.merchant ?? '')) {
    lines.push(
      `comercio "${before.merchant ?? '—'}" → "${after.merchant ?? '—'}"`,
    );
  }
  if ((before.receiptDate ?? '') !== (after.receiptDate ?? '')) {
    lines.push(
      `fecha ${before.receiptDate ?? '—'} → ${after.receiptDate ?? '—'}`,
    );
  }
  if (before.motiveId !== after.motiveId || before.description !== after.description) {
    lines.push(
      `motivo "${before.description ?? '—'}" → "${after.description ?? '—'}"`,
    );
  }
  if (before.locationId !== after.locationId) {
    const [locBefore, locAfter] = await Promise.all([
      before.locationId ? getLocationById(before.locationId) : undefined,
      after.locationId ? getLocationById(after.locationId) : undefined,
    ]);
    lines.push(
      `ubicación ${locBefore?.name ?? before.locationId ?? '—'} → ${locAfter?.name ?? after.locationId ?? '—'}`,
    );
  }
  if (before.clientId !== after.clientId) {
    const [cliBefore, cliAfter] = await Promise.all([
      getClientById(before.clientId),
      getClientById(after.clientId),
    ]);
    lines.push(
      `cliente ${cliBefore?.name ?? before.clientId} → ${cliAfter?.name ?? after.clientId}`,
    );
  }
  const beforeGlpi =
    before.glpiTicketNumber ?? before.glpiTicketId ?? null;
  const afterGlpi = after.glpiTicketNumber ?? after.glpiTicketId ?? null;
  if (beforeGlpi !== afterGlpi) {
    lines.push(
      `incidente GLPI ${beforeGlpi != null ? `#${beforeGlpi}` : '—'} → ${afterGlpi != null ? `#${afterGlpi}` : '—'}`,
    );
  }
  return lines;
}

/** Role IDs this user may assign when managing team (roles they approve in any chain). */
async function assignableRoleIdsForSupervisor(
  user: AuthUser,
): Promise<Set<string>> {
  const chains = await listApprovalChains();
  const ids = new Set<string>();
  const myRoleId = user.panelRoleId ?? user.role?.id;
  for (const chain of chains) {
    if (chain.steps.some((s) => s.approverRoleId === myRoleId)) {
      ids.add(chain.submitterRoleId);
    }
  }
  if (ids.size === 0) {
    ids.add(SEED_ROLE_IDS.tecnico);
  }
  return ids;
}

function technicianManagedByUser(technician: Employee, user: AuthUser): boolean {
  if (user.capabilities.canConfigureRoles) return true;
  if (technician.managerEntraOid && technician.managerEntraOid === user.oid) {
    return true;
  }
  return false;
}

async function canUserApproveExpense(
  user: AuthUser,
  expense: Expense,
): Promise<boolean> {
  if (!user.capabilities.canApprove) return false;
  if (expense.status !== 'PENDING' && expense.status !== 'NEEDS_INFO') {
    return false;
  }

  const submitterRoleId =
    expense.submitterRoleId ?? SEED_ROLE_IDS.tecnico;
  const chain = await getApprovalChain(submitterRoleId);
  const steps = chain?.steps ?? [
    { order: 0, approverRoleId: SEED_ROLE_IDS.admin },
  ];
  const step = expense.approvalStep ?? 0;
  const requiredRoleId = steps[step]?.approverRoleId;
  if (!requiredRoleId) return false;

  if (user.capabilities.canConfigureRoles) return true;

  const myRoleId = user.panelRoleId ?? user.role?.id;
  if (myRoleId !== requiredRoleId) return false;

  const submitter = await getEmployeeById(expense.technicianId);
  if (!submitter) return false;

  if (submitter.managerEntraOid) {
    return submitter.managerEntraOid === user.oid;
  }

  if (!submitter.managerEntraOid && !submitter.managerId) return true;

  return user.isBootstrapAdmin;
}

async function filterInbox(
  user: AuthUser,
  items: Expense[],
): Promise<Expense[]> {
  const out: Expense[] = [];
  for (const e of items) {
    if (await canUserApproveExpense(user, e)) out.push(e);
  }
  return out;
}

async function getTelegramToken(): Promise<string> {
  if (telegramToken) return telegramToken;
  const client = new SecretsManagerClient({});
  const result = await client.send(
    new GetSecretValueCommand({ SecretId: TELEGRAM_SECRET_NAME }),
  );
  const raw = result.SecretString ?? '';
  try {
    const parsed = JSON.parse(raw) as { token?: string; botToken?: string };
    telegramToken = parsed.token ?? parsed.botToken ?? raw;
  } catch {
    telegramToken = raw;
  }
  if (!telegramToken) throw new Error('Telegram token not configured');
  return telegramToken;
}

async function signedReceiptUrl(key: string): Promise<string | undefined> {
  if (!RECEIPTS_BUCKET || !key) return undefined;
  const s3 = new S3Client({});
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: RECEIPTS_BUCKET, Key: key }),
    { expiresIn: 900 },
  );
}

function filterExpenses(
  items: Expense[],
  params: Record<string, string | undefined>,
): Expense[] {
  return items.filter((e) => {
    if (params.clientId && e.clientId !== params.clientId) return false;
    if (params.projectId && e.projectId !== params.projectId) return false;
    if (params.technicianId && e.technicianId !== params.technicianId)
      return false;
    if (
      (params.kind === 'PROYECTO' || params.kind === 'SERVICIO') &&
      e.kind !== params.kind
    ) {
      return false;
    }
    const dateField = e.receiptDate ?? e.submittedAt;
    if (params.from && dateField < params.from) return false;
    if (params.to && dateField > `${params.to}T23:59:59.999Z`) return false;
    return true;
  });
}

async function listExpenses(
  params: Record<string, string | undefined>,
): Promise<Expense[]> {
  let items: Expense[];
  if (params.status) {
    items = await listExpensesByStatus(params.status as ExpenseStatus);
  } else {
    items = await scan<Expense>({ TableName: TABLE_NAMES.expenses });
  }
  return filterExpenses(items, params);
}

async function listProjects(clientId?: string): Promise<Project[]> {
  if (clientId) {
    try {
      return await query<Project>({
        TableName: TABLE_NAMES.projects,
        IndexName: GSI_NAMES.projectsByClientId,
        KeyConditionExpression: 'clientId = :clientId',
        ExpressionAttributeValues: { ':clientId': clientId },
      });
    } catch {
      return scan<Project>({
        TableName: TABLE_NAMES.projects,
        FilterExpression: 'clientId = :clientId',
        ExpressionAttributeValues: { ':clientId': clientId },
      });
    }
  }
  return scan<Project>({ TableName: TABLE_NAMES.projects });
}

function pickDefined<T extends Record<string, unknown>>(
  body: T,
  keys: (keyof T)[],
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of keys) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

async function patchEntity<T extends { id: string; updatedAt: string }>(
  table: string,
  id: string,
  updates: Partial<T>,
): Promise<T | undefined> {
  const existing = await getItem<T>({ TableName: table, Key: { id } });
  if (!existing) return undefined;
  const merged = { ...existing, ...updates, id, updatedAt: nowIso() };
  await putItem({ TableName: table, Item: merged });
  return merged;
}

function sumTotals(
  expenses: Expense[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const e of expenses) {
    totals[e.currency] = (totals[e.currency] ?? 0) + e.amount;
  }
  return totals;
}

function parseClientKind(kind?: string): ClientKind {
  return kind === 'SERVICIO' ? 'SERVICIO' : 'PROYECTO';
}

/** Returns PROYECTO/SERVICIO or undefined if missing/invalid. */
function parseExpenseKind(kind?: string): ClientKind | undefined {
  if (kind === 'PROYECTO' || kind === 'SERVICIO') return kind;
  return undefined;
}

async function buildBandejaLookups() {
  const [clients, projects, technicians, motives, locations] = await Promise.all([
    scan<Client>({ TableName: TABLE_NAMES.clients }),
    scan<Project>({ TableName: TABLE_NAMES.projects }),
    listEmployees(),
    listMotives(),
    listLocations(),
  ]);
  return {
    clients: new Map(clients.map((c) => [c.id, c])),
    projects: new Map(projects.map((p) => [p.id, p])),
    technicians: new Map(technicians.map((t) => [t.id, t])),
    motives: new Map(motives.map((m) => [m.id, m])),
    locations: new Map(locations.map((l) => [l.id, l])),
  };
}

function normalizeCapabilities(
  raw: Partial<RoleCapabilities> | undefined,
  fallback: RoleCapabilities,
): RoleCapabilities {
  return {
    canApprove: raw?.canApprove ?? fallback.canApprove,
    canLiquidate: raw?.canLiquidate ?? fallback.canLiquidate,
    canManageMasters: raw?.canManageMasters ?? fallback.canManageMasters,
    canManageTeam: raw?.canManageTeam ?? fallback.canManageTeam,
    canConfigureRoles: raw?.canConfigureRoles ?? fallback.canConfigureRoles,
  };
}

export async function handleAdminApi(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const origin = event.headers.origin ?? event.headers.Origin;
  const method = event.requestContext.http.method;
  const path = normalizePath(event.rawPath);
  const qs = event.queryStringParameters ?? {};

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(origin), body: '' };
  }

  if (method === 'GET' && path === '/health') {
    return jsonResponse(200, { status: 'ok' }, origin);
  }

  let user: AuthUser;
  try {
    await ensureSeedRolesAndChains();
    user = await authenticatePanelUser(
      event.headers.authorization ?? event.headers.Authorization,
    );
  } catch (err) {
    if (err instanceof Error && 'statusCode' in err) {
      const ae = err as { statusCode: number; message: string };
      return jsonResponse(ae.statusCode, { error: ae.message }, origin);
    }
    console.error('Auth failure', err);
    return jsonResponse(401, { error: 'Unauthorized' }, origin);
  }

  try {
    // --- Me ---
    if (method === 'GET' && path === '/me') {
      return jsonResponse(
        200,
        {
          oid: user.oid,
          name: user.name,
          email: user.email,
          isBootstrapAdmin: user.isBootstrapAdmin,
          isSupervisorGroupMember: user.isSupervisorGroupMember,
          panelRoleId: user.panelRoleId,
          panelRoleLabel: user.panelRoleLabel,
          role: user.role,
          capabilities: user.capabilities,
        },
        origin,
      );
    }

    // --- Entra / Graph ---
    if (method === 'GET' && path === '/entra/supervisors') {
      if (
        !user.capabilities.canConfigureRoles &&
        !user.capabilities.canManageTeam
      ) {
        throw new HttpError(403, 'Forbidden');
      }
      try {
        const items = await listSupervisorGroupMembers();
        return jsonResponse(200, { items }, origin);
      } catch (err) {
        console.error('Graph supervisors list failed', err);
        return jsonResponse(
          503,
          {
            error:
              'Graph server-side no disponible para apps SPA. El panel carga supervisores directamente desde Microsoft Entra.',
            code: 'graph_spa_fallback',
          },
          origin,
        );
      }
    }

    // --- Roles ---
    if (method === 'GET' && path === '/roles') {
      // Readable by anyone who can manage team or configure (to pick role on employee form)
      if (
        !user.capabilities.canConfigureRoles &&
        !user.capabilities.canManageTeam &&
        !user.capabilities.canApprove
      ) {
        throw new HttpError(403, 'Forbidden');
      }
      let items = await listRoles();
      if (!user.capabilities.canConfigureRoles && user.capabilities.canManageTeam) {
        const assignable = await assignableRoleIdsForSupervisor(user);
        items = items.filter((r) => assignable.has(r.id) || r.id === user.panelRoleId);
      }
      return jsonResponse(200, { items }, origin);
    }
    if (method === 'POST' && path === '/roles') {
      requireCap(user, 'canConfigureRoles');
      const body = parseBody<Partial<Role> & { capabilities?: Partial<RoleCapabilities> }>(event);
      if (!body.name?.trim()) {
        return jsonResponse(400, { error: 'name is required' }, origin);
      }
      const empty: RoleCapabilities = {
        canApprove: false,
        canLiquidate: false,
        canManageMasters: false,
        canManageTeam: false,
        canConfigureRoles: false,
      };
      const item = await createRole({
        name: body.name.trim(),
        active: body.active ?? true,
        capabilities: normalizeCapabilities(body.capabilities, empty),
      });
      return jsonResponse(201, item, origin);
    }
    {
      const m = matchPath('/roles/{id}', path);
      if (m && (method === 'PUT' || method === 'PATCH')) {
        requireCap(user, 'canConfigureRoles');
        const body = parseBody<Partial<Role> & { capabilities?: Partial<RoleCapabilities> }>(event);
        const existing = await getRoleById(m.id);
        if (!existing) return jsonResponse(404, { error: 'Not found' }, origin);
        const item = await updateRole(m.id, {
          name: body.name ?? existing.name,
          active: body.active ?? existing.active,
          capabilities: body.capabilities
            ? normalizeCapabilities(body.capabilities, existing.capabilities)
            : existing.capabilities,
        });
        return jsonResponse(200, item, origin);
      }
    }

    // --- Approval chains ---
    if (method === 'GET' && path === '/approval-chains') {
      requireCap(user, 'canConfigureRoles');
      const items = await listApprovalChains();
      return jsonResponse(200, { items }, origin);
    }
    if (method === 'PUT' && path === '/approval-chains') {
      requireCap(user, 'canConfigureRoles');
      const body = parseBody<{
        submitterRoleId?: string;
        steps?: ApprovalChainStep[];
      }>(event);
      if (!body.submitterRoleId || !Array.isArray(body.steps)) {
        return jsonResponse(
          400,
          { error: 'submitterRoleId and steps are required' },
          origin,
        );
      }
      const chain = await upsertApprovalChain(body.submitterRoleId, body.steps);
      return jsonResponse(200, chain, origin);
    }

    // --- Clients ---
    if (method === 'GET' && path === '/clients') {
      if (
        !user.capabilities.canManageMasters &&
        !user.capabilities.canApprove &&
        !user.capabilities.canLiquidate
      ) {
        throw new HttpError(403, 'Forbidden');
      }
      const items = await scan<Client>({ TableName: TABLE_NAMES.clients });
      return jsonResponse(200, { items }, origin);
    }
    if (method === 'POST' && path === '/clients') {
      requireCap(user, 'canManageMasters');
      const body = parseBody<Partial<Client>>(event);
      const ts = nowIso();
      const item: Client = {
        id: generateId(),
        name: body.name ?? '',
        code: body.code,
        kind: parseClientKind(body.kind),
        active: body.active ?? true,
        createdAt: ts,
        updatedAt: ts,
      };
      await putItem({ TableName: TABLE_NAMES.clients, Item: item });
      return jsonResponse(201, item, origin);
    }
    {
      const m = matchPath('/clients/{id}', path);
      if (m) {
        if (method === 'GET') {
          const item = await getItem<Client>({
            TableName: TABLE_NAMES.clients,
            Key: { id: m.id },
          });
          if (!item) return jsonResponse(404, { error: 'Not found' }, origin);
          return jsonResponse(200, item, origin);
        }
        if (method === 'PUT' || method === 'PATCH') {
          requireCap(user, 'canManageMasters');
          const body = parseBody<Partial<Client>>(event);
          const existing = await getItem<Client>({
            TableName: TABLE_NAMES.clients,
            Key: { id: m.id },
          });
          if (!existing) return jsonResponse(404, { error: 'Not found' }, origin);
          const updates = pickDefined(body, ['name', 'code', 'active', 'kind']);
          const item = await patchEntity<Client>(TABLE_NAMES.clients, m.id, {
            ...updates,
            name: updates.name ?? existing.name,
            kind:
              updates.kind != null
                ? parseClientKind(String(updates.kind))
                : existing.kind ?? 'PROYECTO',
          });
          return jsonResponse(200, item, origin);
        }
      }
    }

    // --- Projects ---
    if (method === 'GET' && path === '/projects') {
      if (
        !user.capabilities.canManageMasters &&
        !user.capabilities.canApprove &&
        !user.capabilities.canLiquidate
      ) {
        throw new HttpError(403, 'Forbidden');
      }
      const items = await listProjects(qs.clientId);
      return jsonResponse(200, { items }, origin);
    }
    if (method === 'POST' && path === '/projects') {
      requireCap(user, 'canManageMasters');
      const body = parseBody<Partial<Project>>(event);
      const ts = nowIso();
      const item: Project = {
        id: generateId(),
        clientId: body.clientId ?? '',
        name: body.name ?? '',
        code: body.code,
        active: body.active ?? true,
        createdAt: ts,
        updatedAt: ts,
      };
      await putItem({ TableName: TABLE_NAMES.projects, Item: item });
      return jsonResponse(201, item, origin);
    }
    {
      const m = matchPath('/projects/{id}', path);
      if (m) {
        if (method === 'GET') {
          const item = await getItem<Project>({
            TableName: TABLE_NAMES.projects,
            Key: { id: m.id },
          });
          if (!item) return jsonResponse(404, { error: 'Not found' }, origin);
          return jsonResponse(200, item, origin);
        }
        if (method === 'PUT' || method === 'PATCH') {
          requireCap(user, 'canManageMasters');
          const body = parseBody<Partial<Project>>(event);
          const existing = await getItem<Project>({
            TableName: TABLE_NAMES.projects,
            Key: { id: m.id },
          });
          if (!existing) return jsonResponse(404, { error: 'Not found' }, origin);
          const updates = pickDefined(body, [
            'clientId',
            'name',
            'code',
            'active',
          ]);
          const item = await patchEntity<Project>(TABLE_NAMES.projects, m.id, {
            ...updates,
            clientId: updates.clientId ?? existing.clientId,
            name: updates.name ?? existing.name,
          });
          return jsonResponse(200, item, origin);
        }
      }
    }

    // --- Expense motives ---
    if (method === 'GET' && path === '/motives') {
      if (
        !user.capabilities.canManageMasters &&
        !user.capabilities.canApprove &&
        !user.capabilities.canLiquidate
      ) {
        throw new HttpError(403, 'Forbidden');
      }
      const items = await listMotives();
      return jsonResponse(200, { items }, origin);
    }
    if (method === 'POST' && path === '/motives') {
      requireCap(user, 'canManageMasters');
      const body = parseBody<Partial<ExpenseMotive>>(event);
      const ts = nowIso();
      const item: ExpenseMotive = {
        id: generateId(),
        label: body.label ?? '',
        sortOrder: body.sortOrder ?? 0,
        active: body.active ?? true,
        createdAt: ts,
        updatedAt: ts,
      };
      await putItem({ TableName: TABLE_NAMES.expenseMotives, Item: item });
      return jsonResponse(201, item, origin);
    }
    {
      const m = matchPath('/motives/{id}', path);
      if (m) {
        if (method === 'GET') {
          const item = await getItem<ExpenseMotive>({
            TableName: TABLE_NAMES.expenseMotives,
            Key: { id: m.id },
          });
          if (!item) return jsonResponse(404, { error: 'Not found' }, origin);
          return jsonResponse(200, item, origin);
        }
        if (method === 'PUT' || method === 'PATCH') {
          requireCap(user, 'canManageMasters');
          const body = parseBody<Partial<ExpenseMotive>>(event);
          const existing = await getItem<ExpenseMotive>({
            TableName: TABLE_NAMES.expenseMotives,
            Key: { id: m.id },
          });
          if (!existing) return jsonResponse(404, { error: 'Not found' }, origin);
          const updates = pickDefined(body, ['label', 'sortOrder', 'active']);
          const item = await patchEntity<ExpenseMotive>(
            TABLE_NAMES.expenseMotives,
            m.id,
            {
              ...updates,
              label: updates.label ?? existing.label,
            },
          );
          return jsonResponse(200, item, origin);
        }
      }
    }

    // --- Locations ---
    if (method === 'GET' && path === '/locations') {
      if (
        !user.capabilities.canManageMasters &&
        !user.capabilities.canApprove &&
        !user.capabilities.canLiquidate
      ) {
        throw new HttpError(403, 'Forbidden');
      }
      const items = await listLocations();
      return jsonResponse(200, { items }, origin);
    }
    if (method === 'POST' && path === '/locations') {
      requireCap(user, 'canManageMasters');
      const body = parseBody<Partial<Location>>(event);
      const ts = nowIso();
      const item: Location = {
        id: generateId(),
        name: body.name ?? '',
        code: body.code,
        active: body.active ?? true,
        createdAt: ts,
        updatedAt: ts,
      };
      await putItem({ TableName: TABLE_NAMES.locations, Item: item });
      return jsonResponse(201, item, origin);
    }
    {
      const m = matchPath('/locations/{id}', path);
      if (m) {
        if (method === 'GET') {
          const item = await getItem<Location>({
            TableName: TABLE_NAMES.locations,
            Key: { id: m.id },
          });
          if (!item) return jsonResponse(404, { error: 'Not found' }, origin);
          return jsonResponse(200, item, origin);
        }
        if (method === 'PUT' || method === 'PATCH') {
          requireCap(user, 'canManageMasters');
          const body = parseBody<Partial<Location>>(event);
          const existing = await getItem<Location>({
            TableName: TABLE_NAMES.locations,
            Key: { id: m.id },
          });
          if (!existing) return jsonResponse(404, { error: 'Not found' }, origin);
          const updates = pickDefined(body, ['name', 'code', 'active']);
          const item = await patchEntity<Location>(TABLE_NAMES.locations, m.id, {
            ...updates,
            name: updates.name ?? existing.name,
          });
          return jsonResponse(200, item, origin);
        }
      }
    }

    // --- Technicians (Telegram field workers only) ---
    if (method === 'GET' && path === '/technicians') {
      if (
        !user.capabilities.canConfigureRoles &&
        !user.capabilities.canManageTeam &&
        !user.capabilities.canApprove &&
        !user.capabilities.canLiquidate
      ) {
        throw new HttpError(403, 'Forbidden');
      }
      let items: Employee[];
      if (user.capabilities.canConfigureRoles) {
        items = await listTechnicians();
      } else if (user.capabilities.canManageTeam) {
        items = await listEmployeesByManagerEntraOid(user.oid);
      } else {
        items = await listTechnicians();
      }
      items = items.map((e) => ({
        ...e,
        roleId: SEED_ROLE_IDS.tecnico,
      }));
      return jsonResponse(200, { items }, origin);
    }
    if (method === 'POST' && path === '/technicians') {
      if (
        !user.capabilities.canConfigureRoles &&
        !user.capabilities.canManageTeam
      ) {
        throw new HttpError(403, 'Forbidden');
      }
      const body = parseBody<Partial<Employee & { managerEntraOid?: string }>>(
        event,
      );

      if (
        !user.capabilities.canConfigureRoles &&
        body.telegramUserId !== undefined &&
        body.telegramUserId !== ''
      ) {
        return jsonResponse(
          403,
          { error: 'No podés asignar Telegram ID manualmente. Usá la palabra clave.' },
          origin,
        );
      }

      const telegramUserId = user.capabilities.canConfigureRoles
        ? normalizeTelegramUserId(body.telegramUserId)
        : undefined;
      if (body.telegramUserId && !telegramUserId) {
        return jsonResponse(
          400,
          {
            error:
              'Telegram ID debe ser numérico (ej. 123456789), no el @usuario. Pedile al técnico que escriba al bot: le responde su ID.',
          },
          origin,
        );
      }

      const roleId = SEED_ROLE_IDS.tecnico;
      let managerEntraOid: string | undefined;

      if (user.capabilities.canConfigureRoles) {
        managerEntraOid = body.managerEntraOid?.trim() || undefined;
        if (!managerEntraOid) {
          return jsonResponse(
            400,
            { error: 'Seleccioná un supervisor responsable' },
            origin,
          );
        }
      } else {
        managerEntraOid = user.oid;
      }

      const ts = nowIso();
      let telegramLinkCode: string | undefined;
      if (!telegramUserId) {
        telegramLinkCode = await generateUniqueTelegramLinkCode();
      }
      const item: Employee = {
        id: generateId(),
        name: body.name ?? '',
        email: body.email,
        telegramUserId,
        telegramLinkCode,
        roleId,
        managerEntraOid,
        active: body.active ?? true,
        createdAt: ts,
        updatedAt: ts,
      };
      await putEmployee(item);
      return jsonResponse(201, item, origin);
    }
    {
      const m = matchPath('/technicians/{id}/regenerate-link-code', path);
      if (m && method === 'POST') {
        if (
          !user.capabilities.canConfigureRoles &&
          !user.capabilities.canManageTeam
        ) {
          throw new HttpError(403, 'Forbidden');
        }
        const existing = await getEmployeeById(m.id);
        if (!existing) return jsonResponse(404, { error: 'Not found' }, origin);

        if (
          !user.capabilities.canConfigureRoles &&
          !technicianManagedByUser(existing, user)
        ) {
          return jsonResponse(403, { error: 'Fuera de tu equipo' }, origin);
        }

        try {
          const telegramLinkCode = await regenerateEmployeeLinkCode(m.id);
          const updated = await getEmployeeById(m.id);
          return jsonResponse(
            200,
            { telegramLinkCode, ...(updated ?? {}) },
            origin,
          );
        } catch (err) {
          if (err instanceof TelegramLinkError) {
            return jsonResponse(400, { error: err.message }, origin);
          }
          throw err;
        }
      }
    }
    {
      const m = matchPath('/technicians/{id}', path);
      if (m) {
        if (method === 'GET') {
          const item = await getEmployeeById(m.id);
          if (!item) return jsonResponse(404, { error: 'Not found' }, origin);
          return jsonResponse(200, item, origin);
        }
        if (method === 'PUT' || method === 'PATCH') {
          if (
            !user.capabilities.canConfigureRoles &&
            !user.capabilities.canManageTeam
          ) {
            throw new HttpError(403, 'Forbidden');
          }
          const body = parseBody<Partial<Employee>>(event);
          const existing = await getEmployeeById(m.id);
          if (!existing) return jsonResponse(404, { error: 'Not found' }, origin);

          if (
            !user.capabilities.canConfigureRoles &&
            !technicianManagedByUser(existing, user)
          ) {
            return jsonResponse(403, { error: 'Fuera de tu equipo' }, origin);
          }

          if (
            !user.capabilities.canConfigureRoles &&
            body.telegramUserId !== undefined
          ) {
            return jsonResponse(
              403,
              { error: 'No podés modificar Telegram ID manualmente' },
              origin,
            );
          }

          if (
            body.telegramUserId !== undefined &&
            body.telegramUserId !== '' &&
            !normalizeTelegramUserId(body.telegramUserId)
          ) {
            return jsonResponse(
              400,
              {
                error:
                  'Telegram ID debe ser numérico (ej. 123456789), no el @usuario.',
              },
              origin,
            );
          }

          let managerEntraOid =
            body.managerEntraOid !== undefined
              ? body.managerEntraOid || undefined
              : existing.managerEntraOid;

          if (!user.capabilities.canConfigureRoles) {
            managerEntraOid = user.oid;
          } else if (!managerEntraOid) {
            return jsonResponse(
              400,
              { error: 'Seleccioná un supervisor responsable' },
              origin,
            );
          }

          let nextTelegramUserId = existing.telegramUserId;
          let nextTelegramLinkCode = existing.telegramLinkCode;
          if (
            user.capabilities.canConfigureRoles &&
            body.telegramUserId !== undefined
          ) {
            nextTelegramUserId = normalizeTelegramUserId(body.telegramUserId);
            if (nextTelegramUserId) {
              nextTelegramLinkCode = undefined;
            }
          }

          const updates: Partial<Employee> = {
            name: body.name ?? existing.name,
            email: body.email !== undefined ? body.email : existing.email,
            telegramUserId: nextTelegramUserId,
            telegramLinkCode: nextTelegramLinkCode,
            roleId: SEED_ROLE_IDS.tecnico,
            managerEntraOid,
            active: body.active ?? existing.active,
          };
          const item = await patchEntity<Employee>(
            TABLE_NAMES.technicians,
            m.id,
            updates,
          );
          return jsonResponse(200, item, origin);
        }
      }
    }

    // --- GLPI ---
    if (method === 'GET' && path === '/glpi/tickets') {
      requireCap(user, 'canApprove');
      try {
        const tickets = await searchTickets(qs.q ?? '');
        let uiBase: string | undefined;
        try {
          const cfg = await loadGlpiConfig();
          uiBase = glpiUiBaseUrl(cfg.baseUrl);
        } catch {
          uiBase = undefined;
        }
        return jsonResponse(200, { items: tickets, uiBase }, origin);
      } catch (err) {
        console.error('GLPI search failed', err);
        return jsonResponse(
          502,
          {
            error:
              err instanceof Error ? err.message : 'Error al buscar tickets GLPI',
          },
          origin,
        );
      }
    }

    // --- Expenses ---
    if (method === 'GET' && path === '/expenses') {
      if (
        !user.capabilities.canApprove &&
        !user.capabilities.canLiquidate &&
        !user.capabilities.canConfigureRoles
      ) {
        throw new HttpError(403, 'Forbidden');
      }
      let items = await listExpenses({
        status: qs.status,
        clientId: qs.clientId,
        projectId: qs.projectId,
        technicianId: qs.technicianId,
        from: qs.from,
        to: qs.to,
      });
      if (qs.inbox === '1' && user.capabilities.canApprove) {
        items = await filterInbox(user, items);
      }
      return jsonResponse(200, { items }, origin);
    }
    {
      const m = matchPath('/expenses/{id}', path);
      if (m && method === 'GET') {
        const expense = await getExpenseById(m.id);
        if (!expense) return jsonResponse(404, { error: 'Not found' }, origin);
        const messages = await listMessagesByExpenseId(m.id);
        const receiptUrl = expense.receiptS3Key
          ? await signedReceiptUrl(expense.receiptS3Key)
          : undefined;
        const submitterRoleId =
          expense.submitterRoleId ?? SEED_ROLE_IDS.tecnico;
        const chain = await getApprovalChain(submitterRoleId);
        const steps = chain?.steps ?? [
          { order: 0, approverRoleId: SEED_ROLE_IDS.admin },
        ];
        const step = expense.approvalStep ?? 0;
        const isFinalApproval = step >= steps.length - 1;
        return jsonResponse(
          200,
          {
            ...expense,
            messages,
            receiptUrl,
            approvalMeta: {
              step,
              totalSteps: steps.length,
              isFinalApproval,
              requiredRoleId: steps[step]?.approverRoleId,
            },
          },
          origin,
        );
      }
      if (m && method === 'PATCH') {
        requireCap(user, 'canApprove');
        const body = parseBody<ExpenseUpdateBody>(event);
        const expense = await getExpenseById(m.id);
        if (!expense) return jsonResponse(404, { error: 'Not found' }, origin);

        if (
          expense.status !== 'PENDING' &&
          expense.status !== 'NEEDS_INFO'
        ) {
          return jsonResponse(
            400,
            { error: 'Solo se pueden editar gastos pendientes o con info requerida' },
            origin,
          );
        }
        if (!(await canUserApproveExpense(user, expense))) {
          return jsonResponse(403, { error: 'No podés editar este gasto' }, origin);
        }

        const updates: Partial<Expense> = {};

        if (body.amount !== undefined) {
          const amount = Number(body.amount);
          if (!Number.isFinite(amount) || amount <= 0) {
            return jsonResponse(400, { error: 'Invalid amount' }, origin);
          }
          updates.amount = amount;
        }
        if (body.currency !== undefined) {
          updates.currency = body.currency.trim() || 'ARS';
        }
        if (body.merchant !== undefined) {
          updates.merchant = body.merchant.trim() || undefined;
        }
        if (body.receiptDate !== undefined) {
          const d = body.receiptDate.trim();
          if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
            return jsonResponse(400, { error: 'Invalid receiptDate' }, origin);
          }
          updates.receiptDate = d || undefined;
        }
        if (body.motiveId !== undefined) {
          const motive = await getMotiveById(body.motiveId);
          if (!motive?.active) {
            return jsonResponse(400, { error: 'Invalid or inactive motive' }, origin);
          }
          updates.motiveId = motive.id;
          updates.description = motive.label;
        }
        if (body.locationId !== undefined) {
          const location = await getLocationById(body.locationId);
          if (!location?.active) {
            return jsonResponse(
              400,
              { error: 'Invalid or inactive location' },
              origin,
            );
          }
          updates.locationId = location.id;
        }
        if (body.clientId !== undefined) {
          const client = await getClientById(body.clientId);
          if (!client?.active) {
            return jsonResponse(400, { error: 'Invalid or inactive client' }, origin);
          }
          if (expense.projectId && body.clientId !== expense.clientId) {
            const project = await getItem<Project>({
              TableName: TABLE_NAMES.projects,
              Key: { id: expense.projectId },
            });
            if (project && project.clientId !== body.clientId) {
              return jsonResponse(
                400,
                {
                  error:
                    'El proyecto asignado no pertenece al cliente seleccionado',
                },
                origin,
              );
            }
          }
          updates.clientId = client.id;
        }
        if (body.glpiTicketId === null) {
          updates.glpiTicketId = undefined;
          updates.glpiTicketNumber = undefined;
          updates.glpiTicketTitle = undefined;
          updates.glpiLinkedAt = undefined;
          updates.glpiFollowupId = undefined;
        } else if (body.glpiTicketId !== undefined) {
          const ticketId = Number(body.glpiTicketId);
          if (!Number.isFinite(ticketId) || ticketId <= 0) {
            return jsonResponse(400, { error: 'Invalid glpiTicketId' }, origin);
          }
          try {
            const ticket = await getTicket(ticketId);
            updates.glpiTicketId = ticket.id;
            updates.glpiTicketNumber = ticket.number;
            updates.glpiTicketTitle = ticket.title;
            updates.glpiLinkedAt = undefined;
            updates.glpiFollowupId = undefined;
          } catch (err) {
            console.error('GLPI lookup on patch failed', err);
            return jsonResponse(
              502,
              {
                error:
                  err instanceof Error
                    ? err.message
                    : 'Error al validar ticket GLPI',
              },
              origin,
            );
          }
        }

        if (Object.keys(updates).length === 0) {
          return jsonResponse(400, { error: 'No fields to update' }, origin);
        }

        const updated = await updateExpense(m.id, updates);
        if (!updated) {
          return jsonResponse(404, { error: 'Not found' }, origin);
        }

        const auditLines = await buildExpenseAuditLines(expense, updated);
        if (auditLines.length > 0) {
          await createExpenseMessage({
            expenseId: m.id,
            sender: 'admin',
            text: `Datos corregidos por administración: ${auditLines.join('; ')}`,
          });
        }

        const messages = await listMessagesByExpenseId(m.id);
        const receiptUrl = updated.receiptS3Key
          ? await signedReceiptUrl(updated.receiptS3Key)
          : undefined;
        const submitterRoleId =
          updated.submitterRoleId ?? SEED_ROLE_IDS.tecnico;
        const chain = await getApprovalChain(submitterRoleId);
        const steps = chain?.steps ?? [
          { order: 0, approverRoleId: SEED_ROLE_IDS.admin },
        ];
        const step = updated.approvalStep ?? 0;
        const isFinalApproval = step >= steps.length - 1;
        return jsonResponse(
          200,
          {
            ...updated,
            messages,
            receiptUrl,
            approvalMeta: {
              step,
              totalSteps: steps.length,
              isFinalApproval,
              requiredRoleId: steps[step]?.approverRoleId,
            },
          },
          origin,
        );
      }
    }
    {
      const m = matchPath('/expenses/{id}/approve', path);
      if (m && method === 'POST') {
        requireCap(user, 'canApprove');
        const body = parseBody<{
          kind?: string;
          projectId?: string;
          ticketId?: number;
        }>(event);
        const expense = await getExpenseById(m.id);
        if (!expense) return jsonResponse(404, { error: 'Not found' }, origin);

        if (!(await canUserApproveExpense(user, expense))) {
          return jsonResponse(403, { error: 'No podés aprobar este gasto' }, origin);
        }

        const submitterRoleId =
          expense.submitterRoleId ?? SEED_ROLE_IDS.tecnico;
        const chain = await getApprovalChain(submitterRoleId);
        const steps = chain?.steps ?? [
          { order: 0, approverRoleId: SEED_ROLE_IDS.admin },
        ];
        const step = expense.approvalStep ?? 0;
        const isFinal = step >= steps.length - 1;
        const requiredRoleId = steps[step]?.approverRoleId ?? SEED_ROLE_IDS.admin;
        const bodyKind = parseExpenseKind(body.kind);

        if (isFinal) {
          const kind = bodyKind ?? expense.kind;
          if (!kind) {
            return jsonResponse(
              400,
              { error: 'kind is required (PROYECTO or SERVICIO)' },
              origin,
            );
          }

          let project: Project | undefined;
          const projectIdTrim = body.projectId?.trim();
          if (projectIdTrim) {
            project = await getItem<Project>({
              TableName: TABLE_NAMES.projects,
              Key: { id: projectIdTrim },
            });
            if (!project || !project.active) {
              return jsonResponse(
                400,
                { error: 'Invalid or inactive project' },
                origin,
              );
            }
            if (project.clientId !== expense.clientId) {
              return jsonResponse(
                400,
                { error: 'Project does not belong to expense client' },
                origin,
              );
            }
          } else if (expense.projectId) {
            project = await getItem<Project>({
              TableName: TABLE_NAMES.projects,
              Key: { id: expense.projectId },
            });
          }

          const clientEntity = await getItem<Client>({
            TableName: TABLE_NAMES.clients,
            Key: { id: expense.clientId },
          });
          const technician = await getEmployeeById(expense.technicianId);

          const glpiUpdates: Partial<Expense> = {};
          const ticketIdToLink =
            expense.glpiTicketId ??
            (body.ticketId != null ? Number(body.ticketId) : undefined);
          if (ticketIdToLink != null) {
            const ticketId = Number(ticketIdToLink);
            if (!Number.isFinite(ticketId) || ticketId <= 0) {
              return jsonResponse(400, { error: 'Invalid ticketId' }, origin);
            }
            try {
              const ticket =
                expense.glpiTicketId === ticketId &&
                expense.glpiTicketTitle
                  ? {
                      id: expense.glpiTicketId,
                      number: expense.glpiTicketNumber ?? expense.glpiTicketId,
                      title: expense.glpiTicketTitle,
                    }
                  : await getTicket(ticketId);
              const followupLines = [
                'Gasto aprobado en Sistema Viáticos',
                `ID: ${expense.id}`,
                `Técnico: ${technician?.name ?? expense.technicianId}`,
                `Monto: ${expense.amount} ${expense.currency}`,
                `Comercio: ${expense.merchant ?? '—'}`,
                `Fecha comprobante: ${expense.receiptDate ?? '—'}`,
                `Cliente: ${clientEntity?.name ?? expense.clientId}`,
                `Tipo: ${kind === 'SERVICIO' ? 'Servicio' : 'Proyecto'}`,
                `Proyecto: ${project?.name ?? '—'}`,
                `Motivo: ${expense.description ?? '—'}`,
              ];
              const followupId = await addTicketFollowup(
                ticketId,
                followupLines.join('\n'),
              );
              const tsLink = nowIso();
              glpiUpdates.glpiTicketId = ticket.id;
              glpiUpdates.glpiTicketNumber = ticket.number;
              glpiUpdates.glpiTicketTitle = ticket.title;
              glpiUpdates.glpiLinkedAt = tsLink;
              glpiUpdates.glpiFollowupId = followupId;
            } catch (err) {
              console.error('GLPI link on approve failed', err);
              return jsonResponse(
                502,
                {
                  error:
                    err instanceof Error
                      ? err.message
                      : 'Error al vincular ticket GLPI',
                },
                origin,
              );
            }
          }

          const ts = nowIso();
          const history = [
            ...(expense.approvalHistory ?? []),
            {
              step,
              approverRoleId: requiredRoleId,
              approvedBy: actorId(user),
              at: ts,
            },
          ];
          const updated = await updateExpense(m.id, {
            status: 'APPROVED',
            kind,
            ...(project ? { projectId: project.id } : {}),
            reviewedAt: ts,
            reviewedBy: actorId(user),
            approvalStep: step,
            approvalHistory: history,
            ...glpiUpdates,
          });
          return jsonResponse(
            200,
            updated ?? { id: m.id, status: 'APPROVED' },
            origin,
          );
        }

        // Intermediate step
        const ts = nowIso();
        const history = [
          ...(expense.approvalHistory ?? []),
          {
            step,
            approverRoleId: requiredRoleId,
            approvedBy: actorId(user),
            at: ts,
          },
        ];
        const updated = await updateExpense(m.id, {
          status: 'PENDING',
          approvalStep: step + 1,
          approvalHistory: history,
          ...(bodyKind ? { kind: bodyKind } : {}),
          projectId: body.projectId?.trim() || expense.projectId,
        });
        return jsonResponse(200, updated, origin);
      }
    }
    {
      const m = matchPath('/expenses/{id}/reject', path);
      if (m && method === 'POST') {
        requireCap(user, 'canApprove');
        const body = parseBody<{ text?: string }>(event);
        const reason = body.text?.trim() || undefined;
        const expense = await getExpenseById(m.id);
        if (!expense) return jsonResponse(404, { error: 'Not found' }, origin);
        if (!(await canUserApproveExpense(user, expense))) {
          return jsonResponse(403, { error: 'No podés rechazar este gasto' }, origin);
        }
        const ts = nowIso();
        let message;
        if (reason) {
          message = await createExpenseMessage({
            expenseId: m.id,
            sender: 'admin',
            text: `Rechazado: ${reason}`,
          });
        }
        await updateExpense(m.id, {
          status: 'REJECTED',
          reviewedAt: ts,
          reviewedBy: actorId(user),
        });

        const technician = await getEmployeeById(expense.technicianId);
        const chatId = expense.telegramChatId ?? technician?.telegramUserId;
        if (chatId) {
          const token = await getTelegramToken();
          const tg = new TelegramClient({ botToken: token });
          const summary = [
            expense.merchant ? `Comercio: ${expense.merchant}` : null,
            `Monto: ${expense.amount} ${expense.currency}`,
            expense.receiptDate ? `Fecha: ${expense.receiptDate}` : null,
          ]
            .filter(Boolean)
            .join('\n');
          const text = reason
            ? `Tu gasto fue rechazado.\n\n${summary}\n\nMotivo:\n${reason}`
            : `Tu gasto fue rechazado.\n\n${summary}`;
          await tg.sendMessage({ chatId, text });
        }

        return jsonResponse(
          200,
          { id: m.id, status: 'REJECTED', message },
          origin,
        );
      }
    }
    {
      const m = matchPath('/expenses/{id}/ask', path);
      if (m && method === 'POST') {
        requireCap(user, 'canApprove');
        const body = parseBody<{ text?: string }>(event);
        if (!body.text?.trim()) {
          return jsonResponse(400, { error: 'text is required' }, origin);
        }
        const expense = await getExpenseById(m.id);
        if (!expense) return jsonResponse(404, { error: 'Not found' }, origin);
        if (!(await canUserApproveExpense(user, expense))) {
          return jsonResponse(403, { error: 'No podés consultar este gasto' }, origin);
        }

        const message = await createExpenseMessage({
          expenseId: m.id,
          sender: 'admin',
          text: body.text.trim(),
        });
        await updateExpense(m.id, { status: 'NEEDS_INFO' });

        const technician = await getEmployeeById(expense.technicianId);
        const chatId = expense.telegramChatId ?? technician?.telegramUserId;
        if (chatId) {
          const token = await getTelegramToken();
          const tg = new TelegramClient({ botToken: token });
          await tg.sendMessage({
            chatId,
            text: `Consulta sobre tu gasto:\n\n${body.text.trim()}`,
          });
        }

        return jsonResponse(200, { expenseId: m.id, message }, origin);
      }
    }

    // --- Settlements / Liquidación ---
    if (method === 'GET' && path === '/settlements') {
      requireCap(user, 'canLiquidate');
      const items = await listSettlementBatches(
        qs.status as 'DRAFT' | 'CLOSED' | undefined,
      );
      return jsonResponse(200, { items }, origin);
    }
    if (method === 'POST' && path === '/settlements') {
      requireCap(user, 'canLiquidate');
      const body = parseBody<{
        name?: string;
        periodFrom?: string;
        periodTo?: string;
        expenseIds?: string[];
        autoClose?: boolean;
      }>(event);
      if (!body.periodFrom || !body.periodTo) {
        return jsonResponse(
          400,
          { error: 'periodFrom and periodTo are required' },
          origin,
        );
      }
      const expenseIds = body.expenseIds ?? [];
      const expenses: Expense[] = [];
      for (const id of expenseIds) {
        const e = await getExpenseById(id);
        if (!e) {
          return jsonResponse(400, { error: `Expense not found: ${id}` }, origin);
        }
        if (e.status !== 'APPROVED') {
          return jsonResponse(
            400,
            { error: `Expense ${id} is not APPROVED` },
            origin,
          );
        }
        expenses.push(e);
      }

      const isAutoClose = body.autoClose === true;
      const ts = nowIso();

      const batch = await createSettlementBatch({
        name: body.name,
        periodFrom: body.periodFrom,
        periodTo: body.periodTo,
        status: isAutoClose ? 'CLOSED' : 'DRAFT',
        expenseIds,
        totalByCurrency: sumTotals(expenses),
        createdBy: actorId(user),
        closedBy: isAutoClose ? actorId(user) : undefined,
        closedAt: isAutoClose ? ts : undefined,
      });

      for (const e of expenses) {
        await updateExpense(e.id, {
          status: isAutoClose ? 'PAID' : 'IN_LIQUIDATION',
          paidAt: isAutoClose ? ts : undefined,
          settlementBatchId: batch.id,
        });
      }

      return jsonResponse(201, batch, origin);
    }
    {
      const m = matchPath('/settlements/{id}', path);
      if (m && method === 'GET') {
        requireCap(user, 'canLiquidate');
        const batch = await getSettlementBatchById(m.id);
        if (!batch) return jsonResponse(404, { error: 'Not found' }, origin);
        const expenses: Expense[] = [];
        for (const id of batch.expenseIds) {
          const e = await getExpenseById(id);
          if (e) expenses.push(e);
        }
        return jsonResponse(200, { ...batch, expenses }, origin);
      }
    }
    {
      const m = matchPath('/settlements/{id}/expenses', path);
      if (m && method === 'POST') {
        requireCap(user, 'canLiquidate');
        const body = parseBody<{ expenseIds?: string[]; remove?: boolean }>(event);
        const batch = await getSettlementBatchById(m.id);
        if (!batch) return jsonResponse(404, { error: 'Not found' }, origin);
        if (batch.status !== 'DRAFT') {
          return jsonResponse(400, { error: 'Batch is closed' }, origin);
        }
        const ids = body.expenseIds ?? [];
        let expenseIds = [...batch.expenseIds];

        if (body.remove) {
          for (const id of ids) {
            expenseIds = expenseIds.filter((x) => x !== id);
            const e = await getExpenseById(id);
            if (e?.settlementBatchId === batch.id) {
              await updateExpense(id, {
                status: 'APPROVED',
                settlementBatchId: undefined,
              });
            }
          }
        } else {
          for (const id of ids) {
            if (expenseIds.includes(id)) continue;
            const e = await getExpenseById(id);
            if (!e || e.status !== 'APPROVED') {
              return jsonResponse(
                400,
                { error: `Expense ${id} is not APPROVED` },
                origin,
              );
            }
            expenseIds.push(id);
            await updateExpense(id, {
              status: 'IN_LIQUIDATION',
              settlementBatchId: batch.id,
            });
          }
        }

        const expenses: Expense[] = [];
        for (const id of expenseIds) {
          const e = await getExpenseById(id);
          if (e) expenses.push(e);
        }
        const updated = await updateSettlementBatch(m.id, {
          expenseIds,
          totalByCurrency: sumTotals(expenses),
        });
        return jsonResponse(200, updated, origin);
      }
    }
    {
      const m = matchPath('/settlements/{id}/close', path);
      if (m && method === 'POST') {
        requireCap(user, 'canLiquidate');
        const batch = await getSettlementBatchById(m.id);
        if (!batch) return jsonResponse(404, { error: 'Not found' }, origin);
        if (batch.status !== 'DRAFT') {
          return jsonResponse(400, { error: 'Batch already closed' }, origin);
        }
        const ts = nowIso();
        for (const id of batch.expenseIds) {
          await updateExpense(id, {
            status: 'PAID',
            paidAt: ts,
            settlementBatchId: batch.id,
          });
        }
        const updated = await updateSettlementBatch(m.id, {
          status: 'CLOSED',
          closedBy: actorId(user),
          closedAt: ts,
        });
        return jsonResponse(200, updated, origin);
      }
    }
    {
      const m = matchPath('/settlements/{id}/export.xlsx', path) || matchPath('/settlements/{id}/export.csv', path);
      if (m && method === 'GET') {
        requireCap(user, 'canLiquidate');
        const batch = await getSettlementBatchById(m.id);
        if (!batch) return jsonResponse(404, { error: 'Not found' }, origin);
        const expenses: Expense[] = [];
        for (const id of batch.expenseIds) {
          const e = await getExpenseById(id);
          if (e) expenses.push(e);
        }
        const lookups = await buildBandejaLookups();
        if (path.endsWith('.csv')) {
          const csv = expensesToBandejaCsv(expenses, lookups);
          return textResponse(200, csv, origin, 'text/csv; charset=utf-8');
        }
        const xlsx = await expensesToBandejaXlsx(expenses, lookups);
        return binaryResponse(
          200,
          xlsx,
          origin,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          `liquidacion-${m.id}.xlsx`,
        );
      }
    }

    // --- Reports ---
    if (method === 'GET' && path === '/reports/summary') {
      if (
        !user.capabilities.canApprove &&
        !user.capabilities.canLiquidate &&
        !user.capabilities.canConfigureRoles
      ) {
        throw new HttpError(403, 'Forbidden');
      }
      const items = await listExpenses({
        clientId: qs.clientId,
        projectId: qs.projectId,
        kind: qs.kind,
        from: qs.from,
        to: qs.to,
      });

      const byStatus = {
        PENDING: { count: 0, total: 0 },
        NEEDS_INFO: { count: 0, total: 0 },
        APPROVED: { count: 0, total: 0 },
        REJECTED: { count: 0, total: 0 },
        IN_LIQUIDATION: { count: 0, total: 0 },
        PAID: { count: 0, total: 0 },
      } as Record<ExpenseStatus, { count: number; total: number }>;
      const byClient: Record<string, { count: number; total: number }> = {};
      const byProject: Record<string, { count: number; total: number }> = {};
      const byKind: Record<ClientKind, { count: number; total: number }> = {
        PROYECTO: { count: 0, total: 0 },
        SERVICIO: { count: 0, total: 0 },
      };

      for (const e of items) {
        byStatus[e.status] ??= { count: 0, total: 0 };
        byStatus[e.status].count += 1;
        byStatus[e.status].total += e.amount;
        byClient[e.clientId] ??= { count: 0, total: 0 };
        byClient[e.clientId].count += 1;
        byClient[e.clientId].total += e.amount;
        if (e.projectId) {
          byProject[e.projectId] ??= { count: 0, total: 0 };
          byProject[e.projectId].count += 1;
          byProject[e.projectId].total += e.amount;
        }
        if (e.kind === 'PROYECTO' || e.kind === 'SERVICIO') {
          byKind[e.kind].count += 1;
          byKind[e.kind].total += e.amount;
        }
      }

      return jsonResponse(
        200,
        { totalExpenses: items.length, byStatus, byClient, byProject, byKind },
        origin,
      );
    }

    if (
      method === 'GET' &&
      (path === '/reports/export.xlsx' || path === '/reports/export.csv')
    ) {
      if (
        !user.capabilities.canApprove &&
        !user.capabilities.canLiquidate &&
        !user.capabilities.canConfigureRoles
      ) {
        throw new HttpError(403, 'Forbidden');
      }
      const items = await listExpenses({
        status: qs.status,
        clientId: qs.clientId,
        projectId: qs.projectId,
        kind: qs.kind,
        technicianId: qs.technicianId,
        from: qs.from,
        to: qs.to,
      });
      const lookups = await buildBandejaLookups();
      if (path.endsWith('.csv')) {
        const csv = expensesToBandejaCsv(items, lookups);
        return textResponse(200, csv, origin, 'text/csv; charset=utf-8');
      }
      const xlsx = await expensesToBandejaXlsx(items, lookups);
      return binaryResponse(
        200,
        xlsx,
        origin,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'reporte-viaticos.xlsx',
      );
    }

    return jsonResponse(404, { error: 'Not Found' }, origin);
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonResponse(err.statusCode, { error: err.message }, origin);
    }
    console.error('Handler error', err);
    return jsonResponse(500, { error: 'Internal Server Error' }, origin);
  }
}
