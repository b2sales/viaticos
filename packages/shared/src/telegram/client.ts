import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { SECRETS } from '../constants.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

let cachedToken: string | undefined;

export interface TelegramSendMessageParams {
  chatId: number | string;
  text: string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  replyToMessageId?: number;
  replyMarkup?: TelegramInlineKeyboardMarkup;
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramEditMessageParams {
  chatId: number | string;
  messageId: number;
  text: string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  replyMarkup?: TelegramInlineKeyboardMarkup;
}

export interface TelegramClientOptions {
  botToken?: string;
  fetchImpl?: typeof fetch;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  description?: string;
  result?: T;
}

export class TelegramClient {
  private readonly botToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TelegramClientOptions = {}) {
    const token = options.botToken;
    if (!token) {
      throw new Error('TelegramClient requires botToken');
    }
    this.botToken = token;
    this.baseUrl = `${TELEGRAM_API_BASE}/bot${token}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async callApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as TelegramApiResponse<T>;
    if (!response.ok || !payload.ok) {
      throw new Error(
        `Telegram ${method} failed: ${response.status} ${payload.description ?? ''}`.trim(),
      );
    }

    return payload.result as T;
  }

  async sendMessage(params: TelegramSendMessageParams): Promise<{ messageId: number }> {
    const result = await this.callApi<{ message_id: number }>('sendMessage', {
      chat_id: params.chatId,
      text: params.text,
      parse_mode: params.parseMode,
      reply_to_message_id: params.replyToMessageId,
      reply_markup: params.replyMarkup,
    });
    return { messageId: result.message_id };
  }

  async editMessageText(params: TelegramEditMessageParams): Promise<void> {
    try {
      await this.callApi('editMessageText', {
        chat_id: params.chatId,
        message_id: params.messageId,
        text: params.text,
        parse_mode: params.parseMode,
        reply_markup: params.replyMarkup,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Telegram returns 400 when content is unchanged (e.g. duplicate callback).
      if (msg.includes('message is not modified')) {
        return;
      }
      throw err;
    }
  }

  async answerCallbackQuery(params: {
    callbackQueryId: string;
    text?: string;
    showAlert?: boolean;
  }): Promise<void> {
    await this.callApi('answerCallbackQuery', {
      callback_query_id: params.callbackQueryId,
      text: params.text,
      show_alert: params.showAlert,
    });
  }

  async getFile(fileId: string): Promise<{ filePath: string }> {
    const result = await this.callApi<{ file_path: string }>('getFile', {
      file_id: fileId,
    });
    return { filePath: result.file_path };
  }

  async downloadFileBytes(fileId: string): Promise<Uint8Array> {
    const { filePath } = await this.getFile(fileId);
    const response = await this.fetchImpl(
      `${TELEGRAM_API_BASE}/file/bot${this.botToken}/${filePath}`,
    );
    if (!response.ok) {
      throw new Error(`Telegram downloadFile failed: ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  async setWebhook(params: {
    url: string;
    secretToken?: string;
    allowedUpdates?: string[];
  }): Promise<void> {
    await this.callApi('setWebhook', {
      url: params.url,
      secret_token: params.secretToken,
      allowed_updates: params.allowedUpdates ?? ['message', 'callback_query'],
    });
  }
}

export async function getTelegramToken(): Promise<string> {
  if (cachedToken) {
    return cachedToken;
  }

  const envToken = process.env.TELEGRAM_BOT_TOKEN;
  if (envToken) {
    cachedToken = envToken;
    return cachedToken;
  }

  const secretName = process.env.TELEGRAM_SECRET_NAME ?? SECRETS.telegramBotToken;
  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
  });
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretName }),
  );

  if (!response.SecretString) {
    throw new Error(`Secret ${secretName} has no SecretString`);
  }

  let token = response.SecretString;
  try {
    const parsed = JSON.parse(response.SecretString) as { token?: string; botToken?: string };
    token = parsed.token ?? parsed.botToken ?? response.SecretString;
  } catch {
    // plain string secret
  }

  cachedToken = token;
  return cachedToken;
}

export async function createTelegramClient(): Promise<TelegramClient> {
  const botToken = await getTelegramToken();
  return new TelegramClient({ botToken });
}

export async function setWebhook(params: {
  url: string;
  secretToken?: string;
  allowedUpdates?: string[];
}): Promise<void> {
  const client = await createTelegramClient();
  await client.setWebhook(params);
}
