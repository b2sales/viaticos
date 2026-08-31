import ExcelJS from 'exceljs';
import {
  CLIENT_KIND_LABELS,
  EXPENSE_STATUS_LABELS,
  type Expense,
} from '../types/index.js';
import type { BandejaCsvLookups } from './bandeja-csv.js';

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR');
}

function formatGlpi(expense: Expense): string {
  if (expense.glpiTicketNumber != null) return `#${expense.glpiTicketNumber}`;
  if (expense.glpiTicketId != null) return `#${expense.glpiTicketId}`;
  return '—';
}

export async function expensesToBandejaXlsx(
  expenses: Expense[],
  lookups: BandejaCsvLookups,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sistema Viáticos';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Comprobantes', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  worksheet.columns = [
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

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0277BD' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 24;

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

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
