/** Expense workflow status */
export type ExpenseStatus =
  | 'PENDING'
  | 'NEEDS_INFO'
  | 'APPROVED'
  | 'REJECTED'
  | 'IN_LIQUIDATION'
  | 'PAID';

export interface ExpenseSuggestion {
  amount?: number;
  date?: string;
  merchant?: string;
  currency?: string;
  confidence?: number;
}

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
  /** Same as submitterRoleId (partition key). */
  submitterRoleId: string;
  steps: ApprovalChainStep[];
  updatedAt: string;
}

export interface ApprovalHistoryEntry {
  step: number;
  approverRoleId: string;
  approvedBy: string;
  at: string;
}

/** Employee stored in viaticos-technicians table (legacy name). */
export interface Employee {
  id: string;
  name: string;
  email?: string;
  telegramUserId?: string;
  /** 6-char code (a-z0-9) for bot self-linking; cleared after link. */
  telegramLinkCode?: string;
  roleId: string;
  /** @deprecated Prefer managerEntraOid (Entra Object ID of supervisor). */
  managerId?: string;
  /** Entra Object ID of the assigned supervisor (jefe). */
  managerEntraOid?: string;
  /** @deprecated Panel access is via Entra groups; not used for new technicians. */
  entraOid?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** @deprecated Use Employee */
export type Technician = Employee;

export type ClientKind = 'PROYECTO' | 'SERVICIO';

export interface Client {
  id: string;
  name: string;
  code?: string;
  /** Defaults to PROYECTO when absent (legacy records). */
  kind?: ClientKind;
  active: boolean;
  createdAt: string;
  updatedAt: string;
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

export interface Expense {
  id: string;
  technicianId: string;
  /** Set by admin on final approve; absent while PENDING from bot. */
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
  suggestion?: ExpenseSuggestion;
  telegramChatId?: string;
  receiptS3Key?: string;
  ocrRawText?: string;
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

export interface ExpenseMessage {
  id: string;
  expenseId: string;
  sender: 'technician' | 'admin' | 'bot';
  text: string;
  telegramMessageId?: number;
  createdAt: string;
}

export type BotSessionState =
  | 'IDLE'
  | 'AWAITING_LINK_CODE'
  | 'AWAITING_OCR_CONFIRM'
  | 'AWAITING_AMOUNT'
  | 'AWAITING_DATE'
  | 'AWAITING_MERCHANT'
  | 'AWAITING_MOTIVO'
  | 'AWAITING_LOCATION'
  | 'AWAITING_CLIENT'
  | 'AWAITING_INCIDENTE'
  | 'AWAITING_FINAL';

export interface BotSession {
  telegramUserId: string;
  technicianId?: string;
  state: BotSessionState;
  context?: Record<string, unknown>;
  updatedAt: string;
}

export const SEED_ROLE_IDS = {
  tecnico: 'role-tecnico',
  supervisor: 'role-supervisor',
  admin: 'role-admin',
  liquidacion: 'role-liquidacion',
} as const;

export const TABLE_NAMES = {
  technicians: 'viaticos-technicians',
  clients: 'viaticos-clients',
  projects: 'viaticos-projects',
  expenses: 'viaticos-expenses',
  expenseMessages: 'viaticos-expense-messages',
  botSessions: 'viaticos-bot-sessions',
  roles: 'viaticos-roles',
  approvalChains: 'viaticos-approval-chains',
  settlementBatches: 'viaticos-settlement-batches',
  expenseMotives: 'viaticos-expense-motives',
  locations: 'viaticos-locations',
} as const;

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  PENDING: 'Pendiente',
  NEEDS_INFO: 'Info requerida',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
  IN_LIQUIDATION: 'En liquidación',
  PAID: 'Pagado',
};

export const CLIENT_KIND_LABELS: Record<ClientKind, string> = {
  PROYECTO: 'Proyecto',
  SERVICIO: 'Servicio',
};

export type TableName = (typeof TABLE_NAMES)[keyof typeof TABLE_NAMES];

export const GSI_NAMES = {
  expensesByStatus: 'status-index',
  expensesByTechnicianMonth: 'technician-month-index',
  techniciansByTelegramUserId: 'telegram-user-id-index',
  techniciansByLinkCode: 'telegram-link-code-index',
  techniciansByEntraOid: 'entra-oid-index',
  techniciansByManagerId: 'manager-id-index',
  techniciansByManagerEntraOid: 'manager-entra-oid-index',
  projectsByClientId: 'client-id-index',
  expenseMessagesByExpenseId: 'expense-id-index',
} as const;

export type GsiName = (typeof GSI_NAMES)[keyof typeof GSI_NAMES];
