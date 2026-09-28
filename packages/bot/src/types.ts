import type {
  BotSession,
  BotSessionState,
  ExpenseSuggestion,
  Technician,
  TelegramClient,
  TelegramInlineKeyboardMarkup,
} from '@viaticos/shared';

export interface TelegramUser {
  id: number;
  first_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  photo?: Array<{ file_id: string; width: number; height: number }>;
  document?: TelegramDocument;
  reply_to_message?: TelegramMessage;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface ExpenseDraft {
  amount?: number;
  date?: string;
  merchant?: string;
  /** Motivo del gasto (label denormalizado en Expense.description). */
  motivo?: string;
  motiveId?: string;
  locationId?: string;
  locationName?: string;
  glpiTicketId?: number;
  glpiTicketNumber?: number;
  glpiTicketTitle?: string;
  currency?: string;
  receiptS3Key?: string;
  ocrRawText?: string;
  suggestion?: ExpenseSuggestion | null;
  clientId?: string;
  promptMessageId?: number;
  replyingExpenseId?: string;
  /** True when started with /gasto (no photo). */
  manual?: boolean;
}

export interface BotContext {
  draft?: ExpenseDraft;
  detallePage?: number;
}

export const UNAUTHORIZED_MSG =
  'No estás habilitado. Pedile a tu supervisor la palabra clave de 6 letras y números.';

export const LINK_CODE_PROMPT =
  'Para usar el bot necesitás vincular tu cuenta.\n\n' +
  'Pedile a tu supervisor la *palabra clave* (6 letras y números, minúsculas) e ingresala acá.';

export const LINK_CODE_INVALID_FORMAT =
  'La palabra clave debe tener exactamente 6 letras minúsculas o números (ej. a3k9m2).';

export const LINK_CODE_INVALID =
  'Palabra clave incorrecta. Verificá con tu supervisor e intentá de nuevo.';

export const LINK_CODE_MAX_ATTEMPTS =
  'Superaste el límite de intentos. Contactá a tu supervisor para obtener una nueva palabra clave.';

export const MAX_LINK_CODE_ATTEMPTS = 5;

export function unauthorizedMessage(_telegramUserId: string): string {
  return `${UNAUTHORIZED_MSG}\n\n${LINK_CODE_PROMPT}`;
}

export const PAGE_SIZE = 5;

export function getDraft(session: BotSession | undefined): ExpenseDraft {
  const draft = session?.context?.draft;
  if (draft && typeof draft === 'object') {
    return draft as ExpenseDraft;
  }
  return {};
}

export function getContext(session: BotSession | undefined): BotContext {
  return (session?.context as BotContext | undefined) ?? {};
}

export function buildSession(
  telegramUserId: string,
  technician: Technician,
  state: BotSessionState,
  context: BotContext,
): BotSession {
  return {
    telegramUserId,
    technicianId: technician.id,
    state,
    context: context as Record<string, unknown>,
    updatedAt: new Date().toISOString(),
  };
}

export function buildLinkSession(
  telegramUserId: string,
  context: Record<string, unknown> = {},
): BotSession {
  return {
    telegramUserId,
    state: 'AWAITING_LINK_CODE',
    context,
    updatedAt: new Date().toISOString(),
  };
}

export function formatCurrency(amount: number, currency = 'ARS'): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatOcrSummary(draft: ExpenseDraft): string {
  const lines = ['Datos detectados del comprobante:'];
  if (draft.amount != null) {
    lines.push(`• Monto: ${formatCurrency(draft.amount, draft.currency ?? 'ARS')}`);
  } else {
    lines.push('• Monto: (no detectado, ingresalo con ✏️ Monto)');
  }
  if (draft.date) {
    lines.push(`• Fecha: ${draft.date}`);
  }
  if (draft.merchant) {
    lines.push(`• Comercio: ${draft.merchant}`);
  }
  if (draft.motivo) {
    lines.push(`• Motivo: ${draft.motivo}`);
  }
  if (draft.suggestion?.confidence != null) {
    lines.push(`• Confianza OCR: ${Math.round(draft.suggestion.confidence * 100)}%`);
  }
  lines.push('', '¿Confirmás estos datos?');
  return lines.join('\n');
}

export function ocrConfirmKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ Confirmar', callback_data: 'ocr:confirm' },
        { text: '❌ Cancelar', callback_data: 'cancel' },
      ],
      [
        { text: '✏️ Monto', callback_data: 'ocr:edit:amount' },
        { text: '📅 Fecha', callback_data: 'ocr:edit:date' },
        { text: '🏪 Comercio', callback_data: 'ocr:edit:merchant' },
      ],
    ],
  };
}

export function cancelKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'cancel' }]],
  };
}

export function clientsKeyboard(
  clients: Array<{ id: string; name: string }>,
): TelegramInlineKeyboardMarkup {
  const rows = clients.map((client) => [
    { text: client.name, callback_data: `client:${client.id}` },
  ]);
  rows.push([{ text: '❌ Cancelar', callback_data: 'cancel' }]);
  return { inline_keyboard: rows };
}

export function catalogKeyboard(
  items: Array<{ id: string; label: string }>,
  prefix: 'motive' | 'location',
): TelegramInlineKeyboardMarkup {
  const rows = items.map((item) => [
    { text: item.label, callback_data: `${prefix}:${item.id}` },
  ]);
  rows.push([{ text: '❌ Cancelar', callback_data: 'cancel' }]);
  return { inline_keyboard: rows };
}

export function incidentKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '❌ Cancelar', callback_data: 'cancel' }],
    ],
  };
}

export function finalConfirmKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ Enviar gasto', callback_data: 'final:confirm' },
        { text: '❌ Cancelar', callback_data: 'cancel' },
      ],
    ],
  };
}

export function detalleKeyboard(page: number, totalPages: number): TelegramInlineKeyboardMarkup {
  const nav: Array<{ text: string; callback_data: string }> = [];
  if (page > 0) {
    nav.push({ text: '◀️ Anterior', callback_data: `detalle:page:${page - 1}` });
  }
  if (page < totalPages - 1) {
    nav.push({ text: 'Siguiente ▶️', callback_data: `detalle:page:${page + 1}` });
  }
  return nav.length > 0 ? { inline_keyboard: [nav] } : { inline_keyboard: [] };
}

export function parseAmount(text: string): number | undefined {
  const normalized = text.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function parseDate(text: string): string | undefined {
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const arMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (arMatch) {
    const day = arMatch[1].padStart(2, '0');
    const month = arMatch[2].padStart(2, '0');
    return `${arMatch[3]}-${month}-${day}`;
  }

  return undefined;
}

export async function sendUnauthorized(
  client: TelegramClient,
  chatId: number,
  telegramUserId: string,
): Promise<void> {
  await client.sendMessage({
    chatId,
    text: unauthorizedMessage(telegramUserId),
    parseMode: 'Markdown',
  });
}

export function helpText(): string {
  return [
    '📋 Comandos disponibles:',
    '/start — Iniciar',
    '/ayuda — Esta ayuda',
    '/gasto — Cargar gasto sin foto (te pregunta los datos)',
    '/resumen — Resumen del mes',
    '/detalle — Detalle paginado del mes',
    '/cancelar — Cancelar carga en curso',
    '',
    '📷 También podés enviar una foto o PDF del comprobante para cargar un gasto con OCR.',
    'El proyecto lo asigna administración al aprobar el gasto.',
  ].join('\n');
}
