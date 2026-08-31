import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import {
  clearBotSession,
  createExpense,
  createExpenseMessage,
  createTelegramClient,
  getBotSession,
  getClientById,
  getEmployeeByLinkCode,
  getExpenseById,
  getLocationById,
  getMotiveById,
  getMonthKey,
  getTechnicianByTelegramUserId,
  getTicket,
  isValidTelegramLinkCode,
  linkEmployeeTelegram,
  listActiveClients,
  listActiveLocations,
  listActiveMotives,
  listExpensesByTechnicianAndMonth,
  listMessagesByExpenseId,
  normalizeTelegramLinkCode,
  processReceipt,
  query,
  saveBotSession,
  SEED_ROLE_IDS,
  TABLE_NAMES,
  updateBotSessionState,
  updateExpense,
  type Expense,
  type TelegramClient,
} from '@viaticos/shared';
import {
  buildSession,
  buildLinkSession,
  cancelKeyboard,
  catalogKeyboard,
  clientsKeyboard,
  detalleKeyboard,
  finalConfirmKeyboard,
  formatCurrency,
  formatOcrSummary,
  getContext,
  getDraft,
  helpText,
  incidentSkipKeyboard,
  LINK_CODE_INVALID,
  LINK_CODE_INVALID_FORMAT,
  LINK_CODE_MAX_ATTEMPTS,
  LINK_CODE_PROMPT,
  MAX_LINK_CODE_ATTEMPTS,
  ocrConfirmKeyboard,
  PAGE_SIZE,
  parseAmount,
  parseDate,
  sendUnauthorized,
  type ExpenseDraft,
  type TelegramUpdate,
} from './types.js';

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
const RECEIPTS_BUCKET = process.env.RECEIPTS_BUCKET ?? '';

function ok(): APIGatewayProxyResultV2 {
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
}

let cachedWebhookSecret: string | undefined;

async function resolveWebhookSecret(): Promise<string | undefined> {
  if (process.env.TELEGRAM_WEBHOOK_SECRET) {
    return process.env.TELEGRAM_WEBHOOK_SECRET;
  }
  if (cachedWebhookSecret) return cachedWebhookSecret;
  const arn = process.env.TELEGRAM_WEBHOOK_SECRET_ARN;
  if (!arn) return undefined;
  const { GetSecretValueCommand, SecretsManagerClient } = await import(
    '@aws-sdk/client-secrets-manager'
  );
  const sm = new SecretsManagerClient({});
  const out = await sm.send(new GetSecretValueCommand({ SecretId: arn }));
  cachedWebhookSecret = out.SecretString;
  return cachedWebhookSecret;
}

async function verifyWebhookSecret(event: APIGatewayProxyEventV2): Promise<boolean> {
  const expected = await resolveWebhookSecret();
  if (!expected) {
    return true;
  }
  const received =
    event.headers['x-telegram-bot-api-secret-token'] ??
    event.headers['X-Telegram-Bot-Api-Secret-Token'];
  return received === expected;
}

async function uploadReceipt(
  technicianId: string,
  bytes: Uint8Array,
  contentType = 'image/jpeg',
  extension = 'jpg',
): Promise<string> {
  const key = `receipts/${technicianId}/${crypto.randomUUID()}.${extension}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: RECEIPTS_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }),
  );
  return key;
}

async function ensureTechnician(telegramUserId: string) {
  const technician = await getTechnicianByTelegramUserId(telegramUserId);
  if (!technician?.active) {
    return undefined;
  }
  return technician;
}

function linkAttemptsFromSession(
  session: Awaited<ReturnType<typeof getBotSession>>,
): number {
  const attempts = session?.context?.linkAttempts;
  return typeof attempts === 'number' && Number.isFinite(attempts) ? attempts : 0;
}

async function promptLinkCode(
  client: TelegramClient,
  chatId: number,
  telegramUserId: string,
  session?: Awaited<ReturnType<typeof getBotSession>>,
): Promise<void> {
  await saveBotSession(
    buildLinkSession(telegramUserId, {
      linkAttempts: linkAttemptsFromSession(session),
    }),
  );
  await client.sendMessage({
    chatId,
    text: LINK_CODE_PROMPT,
    parseMode: 'Markdown',
  });
}

async function handleUnlinkedUser(
  client: TelegramClient,
  update: TelegramUpdate,
  telegramUserId: string,
  chatId: number,
): Promise<void> {
  const session = await getBotSession(telegramUserId);
  const attempts = linkAttemptsFromSession(session);
  const text = update.message?.text?.trim();

  if (text) {
    const code = normalizeTelegramLinkCode(text);

    if (isValidTelegramLinkCode(code)) {
      const employee = await getEmployeeByLinkCode(code);
      if (
        employee?.active &&
        employee.telegramLinkCode &&
        !employee.telegramUserId
      ) {
        try {
          const linked = await linkEmployeeTelegram(employee.id, telegramUserId);
          await saveBotSession(buildSession(telegramUserId, linked, 'IDLE', {}));
          await client.sendMessage({
            chatId,
            text: `Hola ${linked.name}! 👋\n\n${helpText()}`,
          });
          return;
        } catch {
          // Si falló la vinculación concurrente
        }
      }

      const nextAttempts = attempts + 1;
      await saveBotSession(
        buildLinkSession(telegramUserId, { linkAttempts: nextAttempts }),
      );
      if (nextAttempts >= MAX_LINK_CODE_ATTEMPTS) {
        await client.sendMessage({ chatId, text: LINK_CODE_MAX_ATTEMPTS });
      } else {
        await client.sendMessage({ chatId, text: LINK_CODE_INVALID });
      }
      return;
    }

    if (session?.state === 'AWAITING_LINK_CODE' && !text.startsWith('/')) {
      const nextAttempts = attempts + 1;
      await saveBotSession(
        buildLinkSession(telegramUserId, { linkAttempts: nextAttempts }),
      );
      if (nextAttempts >= MAX_LINK_CODE_ATTEMPTS) {
        await client.sendMessage({ chatId, text: LINK_CODE_MAX_ATTEMPTS });
      } else {
        await client.sendMessage({ chatId, text: LINK_CODE_INVALID_FORMAT });
      }
      return;
    }

    if (attempts >= MAX_LINK_CODE_ATTEMPTS) {
      await client.sendMessage({
        chatId,
        text: LINK_CODE_MAX_ATTEMPTS,
      });
      return;
    }

    await promptLinkCode(client, chatId, telegramUserId, session);
    return;
  }

  if (attempts >= MAX_LINK_CODE_ATTEMPTS) {
    await client.sendMessage({
      chatId,
      text: LINK_CODE_MAX_ATTEMPTS,
    });
    return;
  }

  await client.sendMessage({
    chatId,
    text: 'Ingresá la palabra clave de 6 letras y números que te dio tu supervisor.',
  });
  if (session?.state !== 'AWAITING_LINK_CODE') {
    await saveBotSession(
      buildLinkSession(telegramUserId, {
        linkAttempts: attempts,
      }),
    );
  }
}

async function handleStart(
  client: TelegramClient,
  chatId: number,
  telegramUserId: string,
): Promise<void> {
  const technician = await ensureTechnician(telegramUserId);
  if (!technician) {
    await sendUnauthorized(client, chatId, telegramUserId);
    return;
  }

  await saveBotSession(
    buildSession(telegramUserId, technician, 'IDLE', {}),
  );

  await client.sendMessage({
    chatId,
    text: `Hola ${technician.name}! 👋\n\n${helpText()}`,
  });
}

async function handleHelp(client: TelegramClient, chatId: number): Promise<void> {
  await client.sendMessage({ chatId, text: helpText() });
}

async function handleResumen(
  client: TelegramClient,
  chatId: number,
  technicianId: string,
): Promise<void> {
  const monthKey = getMonthKey();
  const expenses = await listExpensesByTechnicianAndMonth(technicianId, monthKey);
  const countable = expenses.filter((e) => e.status !== 'REJECTED');
  const total = countable.reduce((sum, expense) => sum + expense.amount, 0);
  const pending = expenses.filter((e) => e.status === 'PENDING').length;
  const approved = expenses.filter((e) => e.status === 'APPROVED').length;
  const rejected = expenses.filter((e) => e.status === 'REJECTED').length;
  const needsInfo = expenses.filter((e) => e.status === 'NEEDS_INFO').length;

  await client.sendMessage({
    chatId,
    text: [
      `📊 Resumen ${monthKey}`,
      `Gastos: ${countable.length}`,
      `Total: ${formatCurrency(total)}`,
      `Pendientes: ${pending} | Aprobados: ${approved}` +
        (needsInfo ? ` | Info: ${needsInfo}` : '') +
        (rejected ? ` | Rechazados: ${rejected}` : ''),
    ].join('\n'),
  });
}

async function handleDetalle(
  client: TelegramClient,
  chatId: number,
  technicianId: string,
  page = 0,
): Promise<void> {
  const monthKey = getMonthKey();
  const expenses = await listExpensesByTechnicianAndMonth(technicianId, monthKey);
  const totalPages = Math.max(1, Math.ceil(expenses.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const slice = expenses.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  if (slice.length === 0) {
    await client.sendMessage({
      chatId,
      text: `No hay gastos cargados en ${monthKey}.`,
    });
    return;
  }

  const lines = slice.map(
    (expense, index) =>
      `${safePage * PAGE_SIZE + index + 1}. ${expense.receiptDate ?? expense.submittedAt.slice(0, 10)} — ${formatCurrency(expense.amount, expense.currency)} — ${expense.status}${expense.merchant ? ` (${expense.merchant})` : ''}`,
  );

  await client.sendMessage({
    chatId,
    text: [`📄 Detalle ${monthKey} (pág. ${safePage + 1}/${totalPages})`, '', ...lines].join(
      '\n',
    ),
    replyMarkup: detalleKeyboard(safePage, totalPages),
  });
}

async function handleCancel(
  client: TelegramClient,
  chatId: number,
  telegramUserId: string,
  technician: NonNullable<Awaited<ReturnType<typeof ensureTechnician>>>,
): Promise<void> {
  await clearBotSession(telegramUserId);
  await saveBotSession(buildSession(telegramUserId, technician, 'IDLE', {}));
  await client.sendMessage({ chatId, text: 'Carga cancelada.' });
}

async function handleGastoManual(
  client: TelegramClient,
  chatId: number,
  telegramUserId: string,
  technician: NonNullable<Awaited<ReturnType<typeof ensureTechnician>>>,
): Promise<void> {
  const draft: ExpenseDraft = {
    currency: 'ARS',
    manual: true,
  };
  await saveBotSession(
    buildSession(telegramUserId, technician, 'AWAITING_AMOUNT', { draft }),
  );
  await client.sendMessage({
    chatId,
    text:
      'Carga de gasto sin foto.\n\n' +
      'Ingresá el *monto* (ej: 1500 o 1.500,50).\n' +
      'Podés /cancelar en cualquier momento.',
    parseMode: 'Markdown',
    replyMarkup: cancelKeyboard(),
  });
}

async function handleReceiptUpload(
  client: TelegramClient,
  chatId: number,
  fileId: string,
  telegramUserId: string,
  technician: NonNullable<Awaited<ReturnType<typeof ensureTechnician>>>,
  contentType: string,
  extension: string,
): Promise<void> {
  const bytes = await client.downloadFileBytes(fileId);
  const receiptS3Key = await uploadReceipt(technician.id, bytes, contentType, extension);

  let rawText = '';
  let suggestion = null;
  if (RECEIPTS_BUCKET) {
    const ocr = await processReceipt(RECEIPTS_BUCKET, receiptS3Key);
    rawText = ocr.rawText;
    suggestion = ocr.suggestion;
  }

  const draft: ExpenseDraft = {
    amount: suggestion?.amount,
    date: suggestion?.date,
    merchant: suggestion?.merchant,
    currency: suggestion?.currency ?? 'ARS',
    receiptS3Key,
    ocrRawText: rawText,
    suggestion,
  };

  const session = buildSession(telegramUserId, technician, 'AWAITING_OCR_CONFIRM', {
    draft,
  });
  await saveBotSession(session);

  const sent = await client.sendMessage({
    chatId,
    text: formatOcrSummary(draft),
    replyMarkup: ocrConfirmKeyboard(),
  });

  draft.promptMessageId = sent.messageId;
  await saveBotSession({
    ...session,
    context: { draft },
  });
}

async function handlePhoto(
  client: TelegramClient,
  update: TelegramUpdate,
  telegramUserId: string,
  technician: NonNullable<Awaited<ReturnType<typeof ensureTechnician>>>,
): Promise<void> {
  const message = update.message!;
  const chatId = message.chat.id;
  const photos = message.photo ?? [];
  if (photos.length === 0) {
    return;
  }

  const largest = photos[photos.length - 1];
  await handleReceiptUpload(
    client,
    chatId,
    largest.file_id,
    telegramUserId,
    technician,
    'image/jpeg',
    'jpg',
  );
}

async function handleDocument(
  client: TelegramClient,
  update: TelegramUpdate,
  telegramUserId: string,
  technician: NonNullable<Awaited<ReturnType<typeof ensureTechnician>>>,
): Promise<void> {
  const message = update.message!;
  const chatId = message.chat.id;
  const doc = message.document;
  if (!doc) {
    return;
  }

  const mime = doc.mime_type?.toLowerCase() ?? '';
  const fileName = doc.file_name?.toLowerCase() ?? '';

  let contentType = 'application/octet-stream';
  let extension = 'bin';

  if (mime === 'application/pdf' || fileName.endsWith('.pdf')) {
    contentType = 'application/pdf';
    extension = 'pdf';
  } else if (mime === 'image/jpeg' || fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
    contentType = 'image/jpeg';
    extension = 'jpg';
  } else if (mime === 'image/png' || fileName.endsWith('.png')) {
    contentType = 'image/png';
    extension = 'png';
  } else if (mime === 'image/webp' || fileName.endsWith('.webp')) {
    contentType = 'image/webp';
    extension = 'webp';
  } else {
    await client.sendMessage({
      chatId,
      text: 'Formato no compatible. Por favor enviá un archivo PDF o una foto/imagen (JPG, PNG).',
    });
    return;
  }

  await handleReceiptUpload(
    client,
    chatId,
    doc.file_id,
    telegramUserId,
    technician,
    contentType,
    extension,
  );
}

async function promptMotivo(
  client: TelegramClient,
  chatId: number,
  telegramUserId: string,
  technician: NonNullable<Awaited<ReturnType<typeof ensureTechnician>>>,
  draft: ExpenseDraft,
): Promise<void> {
  const motives = await listActiveMotives();
  if (motives.length === 0) {
    await client.sendMessage({
      chatId,
      text: 'No hay motivos activos configurados. Contactá administración.',
    });
    return;
  }

  const session = buildSession(telegramUserId, technician, 'AWAITING_MOTIVO', { draft });
  await saveBotSession(session);
  await client.sendMessage({
    chatId,
    text: 'Seleccioná el *motivo* del gasto:',
    parseMode: 'Markdown',
    replyMarkup: catalogKeyboard(
      motives.map((m) => ({ id: m.id, label: m.label })),
      'motive',
    ),
  });
}

async function promptLocationSelection(
  client: TelegramClient,
  chatId: number,
  telegramUserId: string,
  technician: NonNullable<Awaited<ReturnType<typeof ensureTechnician>>>,
  draft: ExpenseDraft,
  messageId?: number,
): Promise<void> {
  const locations = await listActiveLocations();
  if (locations.length === 0) {
    await client.sendMessage({
      chatId,
      text: 'No hay ubicaciones activas configuradas. Contactá administración.',
    });
    return;
  }

  const session = buildSession(telegramUserId, technician, 'AWAITING_LOCATION', { draft });
  await saveBotSession(session);

  const text = 'Seleccioná la *ubicación* del gasto:';
  const markup = catalogKeyboard(
    locations.map((l) => ({ id: l.id, label: l.name })),
    'location',
  );
  if (messageId) {
    await client.editMessageText({ chatId, messageId, text, replyMarkup: markup });
  } else {
    await client.sendMessage({
      chatId,
      text,
      parseMode: 'Markdown',
      replyMarkup: markup,
    });
  }
}

async function promptIncidente(
  client: TelegramClient,
  chatId: number,
  telegramUserId: string,
  technician: NonNullable<Awaited<ReturnType<typeof ensureTechnician>>>,
  draft: ExpenseDraft,
  messageId?: number,
): Promise<void> {
  const session = buildSession(telegramUserId, technician, 'AWAITING_INCIDENTE', { draft });
  await saveBotSession(session);

  const text =
    'Número de *incidente GLPI* (opcional).\n' +
    'Enviá el número o tocá *Omitir* para continuar sin incidente.';
  const markup = incidentSkipKeyboard();
  if (messageId) {
    await client.editMessageText({
      chatId,
      messageId,
      text,
      parseMode: 'Markdown',
      replyMarkup: markup,
    });
  } else {
    await client.sendMessage({
      chatId,
      text,
      parseMode: 'Markdown',
      replyMarkup: markup,
    });
  }
}

async function promptClientSelection(
  client: TelegramClient,
  chatId: number,
  telegramUserId: string,
  technician: NonNullable<Awaited<ReturnType<typeof ensureTechnician>>>,
  draft: ExpenseDraft,
  messageId?: number,
): Promise<void> {
  const clients = await listActiveClients();
  if (clients.length === 0) {
    await client.sendMessage({
      chatId,
      text: 'No hay clientes activos configurados. Contactá administración.',
    });
    return;
  }

  const session = buildSession(telegramUserId, technician, 'AWAITING_CLIENT', { draft });
  await saveBotSession(session);

  const text = 'Seleccioná el cliente:';
  const markup = clientsKeyboard(clients);
  if (messageId) {
    await client.editMessageText({ chatId, messageId, text, replyMarkup: markup });
  } else {
    await client.sendMessage({ chatId, text, replyMarkup: markup });
  }
}

async function promptFinalConfirm(
  client: TelegramClient,
  chatId: number,
  telegramUserId: string,
  technician: NonNullable<Awaited<ReturnType<typeof ensureTechnician>>>,
  draft: ExpenseDraft,
  messageId?: number,
): Promise<void> {
  const clientEntity = draft.clientId ? await getClientById(draft.clientId) : undefined;
  const locationLabel =
    draft.locationName ??
    (draft.locationId ? (await getLocationById(draft.locationId))?.name : undefined);

  const session = buildSession(telegramUserId, technician, 'AWAITING_FINAL', { draft });
  await saveBotSession(session);

  const glpiLine =
    draft.glpiTicketId != null
      ? `#${draft.glpiTicketNumber ?? draft.glpiTicketId}${draft.glpiTicketTitle ? ` — ${draft.glpiTicketTitle}` : ''}`
      : '—';

  const text = [
    'Confirmá el envío del gasto:',
    `• Monto: ${formatCurrency(draft.amount ?? 0, draft.currency ?? 'ARS')}`,
    `• Fecha: ${draft.date ?? '—'}`,
    `• Comercio: ${draft.merchant ?? '—'}`,
    `• Motivo: ${draft.motivo ?? '—'}`,
    `• Ubicación: ${locationLabel ?? '—'}`,
    `• Cliente: ${clientEntity?.name ?? '—'}`,
    `• Incidente GLPI: ${glpiLine}`,
    '',
    'El proyecto lo asigna administración al aprobar.',
  ].join('\n');

  const markup = finalConfirmKeyboard();
  if (messageId) {
    await client.editMessageText({ chatId, messageId, text, replyMarkup: markup });
  } else {
    await client.sendMessage({ chatId, text, replyMarkup: markup });
  }
}

async function finalizeExpense(
  client: TelegramClient,
  chatId: number,
  _telegramUserId: string,
  technician: NonNullable<Awaited<ReturnType<typeof ensureTechnician>>>,
  draft: ExpenseDraft,
): Promise<void> {
  if (!draft.amount || !draft.clientId || !draft.motiveId || !draft.locationId) {
    await client.sendMessage({
      chatId,
      text: 'Faltan datos para registrar el gasto. Usá /cancelar y volvé a intentar.',
    });
    return;
  }

  const now = new Date().toISOString();
  const submitterRoleId = technician.roleId || SEED_ROLE_IDS.tecnico;
  const expense = await createExpense({
    technicianId: technician.id,
    clientId: draft.clientId,
    motiveId: draft.motiveId,
    locationId: draft.locationId,
    status: 'PENDING',
    amount: draft.amount,
    currency: draft.currency ?? 'ARS',
    description: draft.motivo?.trim(),
    merchant: draft.merchant,
    receiptDate: draft.date,
    suggestion: draft.suggestion ?? undefined,
    telegramChatId: String(chatId),
    receiptS3Key: draft.receiptS3Key,
    ocrRawText: draft.ocrRawText,
    submittedAt: now,
    submitterRoleId,
    approvalStep: 0,
    approvalHistory: [],
    glpiTicketId: draft.glpiTicketId,
    glpiTicketNumber: draft.glpiTicketNumber,
    glpiTicketTitle: draft.glpiTicketTitle,
  });

  await createExpenseMessage({
    expenseId: expense.id,
    sender: 'bot',
    text: 'Gasto registrado desde Telegram.',
  });

  await client.sendMessage({
    chatId,
    text: `✅ Gasto registrado (${formatCurrency(expense.amount, expense.currency)}). Estado: PENDING`,
  });
}

async function handleCallbackQuery(
  client: TelegramClient,
  update: TelegramUpdate,
  telegramUserId: string,
  technician: NonNullable<Awaited<ReturnType<typeof ensureTechnician>>>,
): Promise<void> {
  const callback = update.callback_query!;
  const data = callback.data ?? '';
  const chatId = callback.message?.chat.id;
  const messageId = callback.message?.message_id;

  await client.answerCallbackQuery({ callbackQueryId: callback.id });

  if (!chatId) {
    return;
  }

  const session = await getBotSession(telegramUserId);
  const context = getContext(session);
  const draft = getDraft(session);

  if (data === 'cancel') {
    await handleCancel(client, chatId, telegramUserId, technician);
    if (messageId) {
      await client.editMessageText({
        chatId,
        messageId,
        text: 'Carga cancelada.',
        replyMarkup: { inline_keyboard: [] },
      });
    }
    return;
  }

  if (data.startsWith('detalle:page:')) {
    const page = Number(data.split(':')[2] ?? '0');
    await handleDetalle(client, chatId, technician.id, page);
    return;
  }

  if (data === 'ocr:confirm') {
    if (draft.amount == null) {
      await updateBotSessionState(telegramUserId, 'AWAITING_AMOUNT', {
        ...context,
        draft,
      });
      await client.sendMessage({
        chatId,
        text: 'No se detectó el monto del comprobante. Por favor ingresá el monto (ej: 1500 o 1.500,50):',
        replyMarkup: cancelKeyboard(),
      });
      return;
    }
    await promptMotivo(client, chatId, telegramUserId, technician, draft);
    return;
  }

  if (data === 'ocr:edit:amount') {
    await updateBotSessionState(telegramUserId, 'AWAITING_AMOUNT', {
      ...context,
      draft,
    });
    await client.sendMessage({
      chatId,
      text: 'Ingresá el monto (ej: 1500 o 1.500,50):',
      replyMarkup: cancelKeyboard(),
    });
    return;
  }

  if (data === 'ocr:edit:date') {
    await updateBotSessionState(telegramUserId, 'AWAITING_DATE', {
      ...context,
      draft,
    });
    await client.sendMessage({
      chatId,
      text: 'Ingresá la fecha (YYYY-MM-DD o DD/MM/YYYY):',
      replyMarkup: cancelKeyboard(),
    });
    return;
  }

  if (data === 'ocr:edit:merchant') {
    await updateBotSessionState(telegramUserId, 'AWAITING_MERCHANT', {
      ...context,
      draft,
    });
    await client.sendMessage({
      chatId,
      text: 'Ingresá el nombre del comercio:',
      replyMarkup: cancelKeyboard(),
    });
    return;
  }

  if (data.startsWith('motive:')) {
    const motiveId = data.slice('motive:'.length);
    const motive = await getMotiveById(motiveId);
    if (!motive?.active) {
      await client.sendMessage({ chatId, text: 'Motivo no válido. Elegí otro.' });
      return;
    }
    draft.motiveId = motive.id;
    draft.motivo = motive.label;
    await promptLocationSelection(client, chatId, telegramUserId, technician, draft, messageId);
    return;
  }

  if (data.startsWith('location:')) {
    const locationId = data.slice('location:'.length);
    const location = await getLocationById(locationId);
    if (!location?.active) {
      await client.sendMessage({ chatId, text: 'Ubicación no válida. Elegí otra.' });
      return;
    }
    draft.locationId = location.id;
    draft.locationName = location.name;
    await promptClientSelection(client, chatId, telegramUserId, technician, draft, messageId);
    return;
  }

  if (data.startsWith('client:')) {
    draft.clientId = data.slice('client:'.length);
    await promptIncidente(client, chatId, telegramUserId, technician, draft, messageId);
    return;
  }

  if (data === 'incident:skip') {
    draft.glpiTicketId = undefined;
    draft.glpiTicketNumber = undefined;
    draft.glpiTicketTitle = undefined;
    await promptFinalConfirm(client, chatId, telegramUserId, technician, draft, messageId);
    return;
  }

  if (data === 'final:confirm') {
    // Claim the confirm once — Telegram may deliver the callback twice.
    if (session?.state !== 'AWAITING_FINAL') {
      return;
    }
    await saveBotSession(buildSession(telegramUserId, technician, 'IDLE', {}));

    if (!draft.amount || !draft.clientId || !draft.motiveId || !draft.locationId) {
      await client.sendMessage({
        chatId,
        text: 'Faltan datos para registrar el gasto. Usá /cancelar y volvé a intentar.',
      });
      return;
    }

    await finalizeExpense(client, chatId, telegramUserId, technician, draft);
    if (messageId) {
      await client.editMessageText({
        chatId,
        messageId,
        text: 'Gasto enviado.',
        replyMarkup: { inline_keyboard: [] },
      });
    }
    return;
  }
}

async function handleNeedsInfoReply(
  client: TelegramClient,
  chatId: number,
  telegramUserId: string,
  technician: NonNullable<Awaited<ReturnType<typeof ensureTechnician>>>,
  text: string,
  session: Awaited<ReturnType<typeof getBotSession>>,
): Promise<boolean> {
  const context = getContext(session);
  let expenseId = context.draft?.replyingExpenseId;

  if (!expenseId) {
    const needsInfo = await query<Expense>({
      TableName: TABLE_NAMES.expenses,
      IndexName: 'status-index',
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'NEEDS_INFO' },
    });
    const mine = needsInfo.find((e) => e.technicianId === technician.id);
    expenseId = mine?.id;
  }

  if (!expenseId) {
    return false;
  }

  const expense = await getExpenseById(expenseId);
  if (!expense || expense.technicianId !== technician.id) {
    return false;
  }

  await createExpenseMessage({
    expenseId,
    sender: 'technician',
    text,
  });

  const thread = await listMessagesByExpenseId(expenseId);
  const adminQuestion = [...thread].reverse().find((m) => m.sender === 'admin');

  await updateExpense(expenseId, {
    status: 'PENDING',
    description: adminQuestion
      ? `${expense.description ?? ''}\nRespuesta: ${text}`.trim()
      : text,
  });

  await saveBotSession(buildSession(telegramUserId, technician, 'IDLE', {}));
  await client.sendMessage({
    chatId,
    text: '✅ Respuesta enviada. El gasto volvió a revisión.',
  });
  return true;
}

async function handleTextMessage(
  client: TelegramClient,
  update: TelegramUpdate,
  telegramUserId: string,
  technician: NonNullable<Awaited<ReturnType<typeof ensureTechnician>>>,
): Promise<void> {
  const message = update.message!;
  const chatId = message.chat.id;
  const text = (message.text ?? '').trim();
  const session = await getBotSession(telegramUserId);
  const state = session?.state ?? 'IDLE';
  const draft = getDraft(session);

  if (text.startsWith('/')) {
    if (text.startsWith('/start')) {
      await handleStart(client, chatId, telegramUserId);
      return;
    }
    if (text.startsWith('/ayuda')) {
      await handleHelp(client, chatId);
      return;
    }
    if (text.startsWith('/resumen')) {
      await handleResumen(client, chatId, technician.id);
      return;
    }
    if (text.startsWith('/detalle')) {
      await handleDetalle(client, chatId, technician.id, 0);
      return;
    }
    if (text.startsWith('/cancelar')) {
      await handleCancel(client, chatId, telegramUserId, technician);
      return;
    }
    if (text.startsWith('/gasto')) {
      await handleGastoManual(client, chatId, telegramUserId, technician);
      return;
    }
    await client.sendMessage({ chatId, text: 'Comando no reconocido. Usá /ayuda.' });
    return;
  }

  if (state === 'AWAITING_AMOUNT') {
    const amount = parseAmount(text);
    if (amount == null) {
      await client.sendMessage({ chatId, text: 'Monto inválido. Probá de nuevo.' });
      return;
    }
    draft.amount = amount;
    if (draft.manual) {
      await saveBotSession(
        buildSession(telegramUserId, technician, 'AWAITING_DATE', { draft }),
      );
      await client.sendMessage({
        chatId,
        text: 'Ingresá la *fecha* del comprobante (YYYY-MM-DD o DD/MM/YYYY):',
        parseMode: 'Markdown',
        replyMarkup: cancelKeyboard(),
      });
      return;
    }
    await saveBotSession(
      buildSession(telegramUserId, technician, 'AWAITING_OCR_CONFIRM', { draft }),
    );
    const promptId = draft.promptMessageId;
    if (promptId) {
      await client.editMessageText({
        chatId,
        messageId: promptId,
        text: formatOcrSummary(draft),
        replyMarkup: ocrConfirmKeyboard(),
      });
    } else {
      await client.sendMessage({
        chatId,
        text: formatOcrSummary(draft),
        replyMarkup: ocrConfirmKeyboard(),
      });
    }
    return;
  }

  if (state === 'AWAITING_DATE') {
    const date = parseDate(text);
    if (!date) {
      await client.sendMessage({ chatId, text: 'Fecha inválida. Usá YYYY-MM-DD o DD/MM/YYYY.' });
      return;
    }
    draft.date = date;
    if (draft.manual) {
      await saveBotSession(
        buildSession(telegramUserId, technician, 'AWAITING_MERCHANT', { draft }),
      );
      await client.sendMessage({
        chatId,
        text:
          'Ingresá el *comercio* / descripción (o `-` para omitir):',
        parseMode: 'Markdown',
        replyMarkup: cancelKeyboard(),
      });
      return;
    }
    await saveBotSession(
      buildSession(telegramUserId, technician, 'AWAITING_OCR_CONFIRM', { draft }),
    );
    await client.sendMessage({
      chatId,
      text: formatOcrSummary(draft),
      replyMarkup: ocrConfirmKeyboard(),
    });
    return;
  }

  if (state === 'AWAITING_MERCHANT') {
    draft.merchant = text === '-' ? undefined : text;
    if (draft.manual) {
      await promptMotivo(client, chatId, telegramUserId, technician, draft);
      return;
    }
    await saveBotSession(
      buildSession(telegramUserId, technician, 'AWAITING_OCR_CONFIRM', { draft }),
    );
    await client.sendMessage({
      chatId,
      text: formatOcrSummary(draft),
      replyMarkup: ocrConfirmKeyboard(),
    });
    return;
  }

  if (state === 'AWAITING_INCIDENTE') {
    const trimmed = text.trim();
    if (trimmed === '-' || trimmed.toLowerCase() === 'omitir') {
      draft.glpiTicketId = undefined;
      draft.glpiTicketNumber = undefined;
      draft.glpiTicketTitle = undefined;
      await promptFinalConfirm(client, chatId, telegramUserId, technician, draft);
      return;
    }

    if (!/^\d+$/.test(trimmed)) {
      await client.sendMessage({
        chatId,
        text: 'Ingresá un número de incidente válido o tocá Omitir.',
        replyMarkup: incidentSkipKeyboard(),
      });
      return;
    }

    try {
      const ticket = await getTicket(Number(trimmed));
      draft.glpiTicketId = ticket.id;
      draft.glpiTicketNumber = ticket.number;
      draft.glpiTicketTitle = ticket.title;
      await promptFinalConfirm(client, chatId, telegramUserId, technician, draft);
    } catch {
      await client.sendMessage({
        chatId,
        text: `No encontré el incidente #${trimmed} en GLPI. Verificá el número o tocá Omitir.`,
        replyMarkup: incidentSkipKeyboard(),
      });
    }
    return;
  }

  if (state === 'IDLE') {
    const handled = await handleNeedsInfoReply(
      client,
      chatId,
      telegramUserId,
      technician,
      text,
      session,
    );
    if (!handled) {
      await client.sendMessage({
        chatId,
        text: 'Enviá una foto del comprobante, usá /gasto para cargar sin foto, o /ayuda.',
      });
    }
    return;
  }

  await client.sendMessage({
    chatId,
    text: 'Seguí las instrucciones en pantalla o usá /cancelar.',
  });
}

export async function handleTelegramWebhook(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  if (event.requestContext.http.method !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!(await verifyWebhookSecret(event))) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  let update: TelegramUpdate;
  try {
    update = JSON.parse(event.body ?? '{}') as TelegramUpdate;
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const client = await createTelegramClient();
  const from =
    update.message?.from ??
    update.callback_query?.from;
  const telegramUserId = from ? String(from.id) : undefined;

  if (!telegramUserId) {
    return ok();
  }

  const technician = await ensureTechnician(telegramUserId);
  const chatId =
    update.message?.chat.id ??
    update.callback_query?.message?.chat.id;

  if (!technician) {
    if (chatId != null) {
      await handleUnlinkedUser(client, update, telegramUserId, chatId);
    }
    return ok();
  }

  try {
    if (update.callback_query) {
      await handleCallbackQuery(client, update, telegramUserId, technician);
      return ok();
    }

    if (update.message?.photo?.length) {
      await handlePhoto(client, update, telegramUserId, technician);
      return ok();
    }

    if (update.message?.document) {
      await handleDocument(client, update, telegramUserId, technician);
      return ok();
    }

    if (update.message?.text) {
      await handleTextMessage(client, update, telegramUserId, technician);
      return ok();
    }
  } catch (error) {
    console.error('Telegram webhook error', error);
    if (chatId != null) {
      await client.sendMessage({
        chatId,
        text: 'Ocurrió un error procesando tu solicitud. Intentá de nuevo.',
      });
    }
  }

  return ok();
}

export const handler: APIGatewayProxyHandlerV2 = handleTelegramWebhook;
