import ExcelJS from 'exceljs';
import {
  CLIENT_KIND_LABELS,
  EXPENSE_STATUS_LABELS,
  type Expense,
} from '../types/index.js';
import type { BandejaCsvLookups } from './bandeja-csv.js';

export interface BandejaXlsxOptions {
  /** When set, adds a second sheet with totals per technician for liquidación. */
  loteLabel?: string;
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) {
    const y = Number(dateOnly[1]);
    const m = Number(dateOnly[2]);
    const d = Number(dateOnly[3]);
    return new Date(y, m - 1, d).toLocaleDateString('es-AR');
  }
  return new Date(iso).toLocaleDateString('es-AR');
}

function formatGlpi(expense: Expense): string {
  if (expense.glpiTicketNumber != null) return `#${expense.glpiTicketNumber}`;
  if (expense.glpiTicketId != null) return `#${expense.glpiTicketId}`;
  return '—';
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0277BD' },
  };
  row.alignment = { vertical: 'middle', horizontal: 'center' };
  row.height = 24;
}

function addTotalesPorTecnicoSheet(
  workbook: ExcelJS.Workbook,
  expenses: Expense[],
  lookups: BandejaCsvLookups,
  loteLabel: string,
): void {
  const totals = new Map<string, { technicianId: string; currency: string; total: number }>();

  for (const expense of expenses) {
    const currency = expense.currency || 'ARS';
    const key = `${expense.technicianId}\0${currency}`;
    const existing = totals.get(key);
    if (existing) {
      existing.total += expense.amount;
    } else {
      totals.set(key, {
        technicianId: expense.technicianId,
        currency,
        total: expense.amount,
      });
    }
  }

  const rows = [...totals.values()].sort((a, b) => {
    const nameA = lookups.technicians.get(a.technicianId)?.name ?? a.technicianId;
    const nameB = lookups.technicians.get(b.technicianId)?.name ?? b.technicianId;
    const byName = nameA.localeCompare(nameB, 'es');
    if (byName !== 0) return byName;
    return a.currency.localeCompare(b.currency);
  });

  const worksheet = workbook.addWorksheet('Totales por técnico', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  worksheet.columns = [
    { header: 'Número de lote', key: 'lote', width: 22 },
    { header: 'Técnico / Usuario', key: 'technician', width: 28 },
    { header: 'Moneda', key: 'currency', width: 10 },
    { header: 'Total a pagar', key: 'total', width: 16 },
  ];

  styleHeaderRow(worksheet.getRow(1));

  for (const item of rows) {
    const technician = lookups.technicians.get(item.technicianId);
    const row = worksheet.addRow({
      lote: loteLabel,
      technician: technician?.name ?? item.technicianId,
      currency: item.currency,
      total: item.total,
    });
    const totalCell = row.getCell('total');
    totalCell.numFmt = '#,##0.00';
    totalCell.alignment = { horizontal: 'right' };
  }
}

export async function expensesToBandejaXlsx(
  expenses: Expense[],
  lookups: BandejaCsvLookups,
  options?: BandejaXlsxOptions,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sistema Viáticos';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Comprobantes', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  worksheet.columns = [
    { header: 'ID', key: 'folio', width: 12 },
    { header: 'Estado', key: 'status', width: 22 },
    { header: 'Monto', key: 'amount', width: 16 },
    { header: 'Moneda', key: 'currency', width: 10 },
    { header: 'Comercio', key: 'merchant', width: 26 },
    { header: 'Motivo', key: 'description', width: 30 },
    { header: 'Fecha', key: 'receiptDate', width: 14 },
    { header: 'Cliente', key: 'client', width: 24 },
    { header: 'Tipo', key: 'kind', width: 14 },
    { header: 'Proyecto', key: 'project', width: 24 },
    { header: 'GLPI', key: 'glpi', width: 14 },
    { header: 'Técnico / Empleado', key: 'technician', width: 26 },
    { header: 'Ubicación', key: 'location', width: 20 },
    { header: 'Enviado', key: 'submittedAt', width: 18 },
  ];

  styleHeaderRow(worksheet.getRow(1));

  for (const expense of expenses) {
    const client = lookups.clients.get(expense.clientId);
    const project = expense.projectId
      ? lookups.projects.get(expense.projectId)
      : undefined;
    const technician = lookups.technicians.get(expense.technicianId);
    const location = expense.locationId
      ? lookups.locations.get(expense.locationId)
      : undefined;

    const row = worksheet.addRow({
      folio: expense.folio ?? '—',
      status: EXPENSE_STATUS_LABELS[expense.status] ?? expense.status,
      amount: expense.amount,
      currency: expense.currency || 'ARS',
      merchant: expense.merchant ?? '—',
      description: expense.description ?? '—',
      receiptDate: formatDate(expense.receiptDate),
      client: client?.name ?? expense.clientId,
      kind: expense.kind ? CLIENT_KIND_LABELS[expense.kind] : '—',
      project: project?.name ?? '—',
      glpi: formatGlpi(expense),
      technician: technician?.name ?? expense.technicianId,
      location: location?.name ?? '—',
      submittedAt: formatDate(expense.submittedAt),
    });

    const amountCell = row.getCell('amount');
    amountCell.numFmt = '#,##0.00';
    amountCell.alignment = { horizontal: 'right' };
  }

  if (options?.loteLabel) {
    addTotalesPorTecnicoSheet(workbook, expenses, lookups, options.loteLabel);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
