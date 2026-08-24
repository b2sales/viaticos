import {
  EXPENSE_STATUS_LABELS,
  type Client,
  type Employee,
  type Expense,
  type ExpenseMotive,
  type Location,
  type Project,
} from '../types/index.js';

export interface BandejaCsvLookups {
  clients: Map<string, Client>;
  projects: Map<string, Project>;
  technicians: Map<string, Employee>;
  motives: Map<string, ExpenseMotive>;
  locations: Map<string, Location>;
}

export function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatMoney(amount: number, currency = 'ARS'): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR');
}

function formatGlpi(expense: Expense): string {
  if (expense.glpiTicketNumber != null) return `#${expense.glpiTicketNumber}`;
  if (expense.glpiTicketId != null) return `#${expense.glpiTicketId}`;
  return '—';
}

export function bandejaCsvHeader(): string {
  return [
    'Estado',
    'Monto',
    'Comercio',
    'Motivo',
    'Fecha',
    'Cliente',
    'Proyecto',
    'GLPI',
    'Técnico',
    'Ubicación',
    'Enviado',
  ].join(',');
}

export function expenseToBandejaCsvRow(
  expense: Expense,
  lookups: BandejaCsvLookups,
): string {
  const client = lookups.clients.get(expense.clientId);
  const project = expense.projectId
    ? lookups.projects.get(expense.projectId)
    : undefined;
  const technician = lookups.technicians.get(expense.technicianId);
  const location = expense.locationId
    ? lookups.locations.get(expense.locationId)
    : undefined;

  return [
    csvEscape(EXPENSE_STATUS_LABELS[expense.status] ?? expense.status),
    csvEscape(formatMoney(expense.amount, expense.currency)),
    csvEscape(expense.merchant ?? '—'),
    csvEscape(expense.description ?? '—'),
    csvEscape(formatDate(expense.receiptDate)),
    csvEscape(client?.name ?? expense.clientId),
    csvEscape(project?.name ?? '—'),
    csvEscape(formatGlpi(expense)),
    csvEscape(technician?.name ?? expense.technicianId),
    csvEscape(location?.name ?? '—'),
    csvEscape(formatDate(expense.submittedAt)),
  ].join(',');
}

export function expensesToBandejaCsv(
  expenses: Expense[],
  lookups: BandejaCsvLookups,
): string {
  const rows = expenses.map((e) => expenseToBandejaCsvRow(e, lookups));
  return [bandejaCsvHeader(), ...rows].join('\n');
}
