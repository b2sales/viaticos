export type ExpenseStatus =
  | 'PENDING'
  | 'NEEDS_INFO'
  | 'APPROVED'
  | 'REJECTED'
  | 'IN_LIQUIDATION'
  | 'PAID';

export interface RoleCapabilities {
  canApprove: boolean;
  canLiquidate: boolean;
  canManageMasters: boolean;
  canManageTeam: boolean;
  canConfigureRoles: boolean;
}

export interface Role {
  id: string;
  name: string;
  active: boolean;
  capabilities: RoleCapabilities;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalChainStep {
  order: number;
  approverRoleId: string;
}

export interface ApprovalChain {
  submitterRoleId: string;
  steps: ApprovalChainStep[];
  updatedAt: string;
}

export interface MeResponse {
  oid: string;
  name?: string;
  email?: string;
  isBootstrapAdmin: boolean;
  isSupervisorGroupMember?: boolean;
  panelRoleId?: string;
  panelRoleLabel?: string;
  role?: Role;
  capabilities: RoleCapabilities;
}

export interface EntraSupervisor {
  oid: string;
  name: string;
  email?: string;
}

export type ClientKind = 'PROYECTO' | 'SERVICIO';

export const CLIENT_KIND_LABELS: Record<ClientKind, string> = {
  PROYECTO: 'Proyecto',
  SERVICIO: 'Servicio',
};

export interface Client {
  id: string;
  name: string;
  code?: string;
  kind?: ClientKind;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseUpdateBody {
  amount?: number;
  currency?: string;
  merchant?: string;
  receiptDate?: string;
  motiveId?: string;
  locationId?: string;
  clientId?: string;
  glpiTicketId?: number | null;
}

export interface ExpenseMotive {
  id: string;
  label: string;
  sortOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Location {
  id: string;
  name: string;
  code?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  clientId: string;
  name: string;
  code?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Employee {
  id: string;
  name: string;
  email?: string;
  telegramUserId?: string;
  telegramLinkCode?: string;
  roleId: string;
  /** @deprecated Legacy supervisor employee id */
  managerId?: string;
  managerEntraOid?: string;
  /** @deprecated Panel access via Entra groups */
  entraOid?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** @deprecated Use Employee */
export type Technician = Employee;

export interface ApprovalHistoryEntry {
  step: number;
  approverRoleId: string;
  approvedBy: string;
  at: string;
}

export interface Expense {
  id: string;
  technicianId: string;
  projectId?: string;
  /** Clasificación Proyecto/Servicio elegida al aprobar. */
  kind?: ClientKind;
  clientId: string;
  motiveId?: string;
  locationId?: string;
  status: ExpenseStatus;
  amount: number;
  currency: string;
  description?: string;
  merchant?: string;
  receiptDate?: string;
  receiptS3Key?: string;
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  submitterRoleId?: string;
  approvalStep?: number;
  approvalHistory?: ApprovalHistoryEntry[];
  settlementBatchId?: string;
  paidAt?: string;
  glpiTicketId?: number;
  glpiTicketNumber?: number;
  glpiTicketTitle?: string;
  glpiLinkedAt?: string;
  glpiFollowupId?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalMeta {
  step: number;
  totalSteps: number;
  isFinalApproval: boolean;
  requiredRoleId?: string;
}

export type SettlementBatchStatus = 'DRAFT' | 'CLOSED';

export interface SettlementBatch {
  id: string;
  name?: string;
  periodFrom: string;
  periodTo: string;
  status: SettlementBatchStatus;
  expenseIds: string[];
  totalByCurrency: Record<string, number>;
  createdBy: string;
  closedBy?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export interface SettlementBatchDetail extends SettlementBatch {
  expenses?: Expense[];
}

export interface GlpiTicket {
  id: number;
  number: number;
  title: string;
  status?: number | string;
}

export interface GlpiTicketsResponse {
  items: GlpiTicket[];
  uiBase?: string;
}

export interface ExpenseMessage {
  id: string;
  expenseId: string;
  sender: 'technician' | 'admin' | 'bot';
  text: string;
  createdAt: string;
}

export interface ExpenseDetail extends Expense {
  messages?: ExpenseMessage[];
  receiptUrl?: string;
  approvalMeta?: ApprovalMeta;
}

export interface SummaryReport {
  totalExpenses: number;
  byStatus: Record<string, { count: number; total: number }>;
  byClient: Record<string, { count: number; total: number }>;
  byProject: Record<string, { count: number; total: number }>;
  byKind: Record<string, { count: number; total: number }>;
  byLocation?: Record<string, { count: number; total: number }>;
}

export interface ListResponse<T> {
  items: T[];
}

export function formatMoney(amount: number, currency = 'ARS'): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR');
}

export function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-AR');
}
