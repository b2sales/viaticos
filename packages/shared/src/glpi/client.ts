import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { SECRETS } from '../constants.js';

export interface GlpiConfig {
  baseUrl: string;
  appToken: string;
  userToken: string;
}

export interface GlpiTicketSummary {
  id: number;
  number: number;
  title: string;
  status?: number | string;
}

const FETCH_TIMEOUT_MS = 8000;

/** Ticket search option ids (GLPI defaults). */
const FIELD_TITLE = 1;
const FIELD_ID = 2;
const FIELD_STATUS = 12;
const STATUS_CLOSED = 6;

let cachedConfig: GlpiConfig | undefined;

export async function loadGlpiConfig(secretName?: string): Promise<GlpiConfig> {
  if (cachedConfig) return cachedConfig;

  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
  });
  const response = await client.send(
    new GetSecretValueCommand({
      SecretId: secretName ?? process.env.GLPI_SECRET_NAME ?? SECRETS.glpiConfig,
    }),
  );
  if (!response.SecretString) {
    throw new Error('GLPI config secret has no SecretString');
  }

  const parsed = JSON.parse(response.SecretString) as Partial<GlpiConfig>;
  if (!parsed.baseUrl || !parsed.appToken || !parsed.userToken) {
    throw new Error('GLPI config missing baseUrl, appToken, or userToken');
  }

  cachedConfig = {
    baseUrl: parsed.baseUrl.replace(/\/$/, ''),
    appToken: parsed.appToken,
    userToken: parsed.userToken,
  };
  return cachedConfig;
}

export function glpiUiBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/apirest\.php\/?$/i, '');
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function withSession<T>(
  fn: (sessionToken: string, config: GlpiConfig) => Promise<T>,
): Promise<T> {
  const config = await loadGlpiConfig();
  const initRes = await fetchWithTimeout(`${config.baseUrl}/initSession`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'App-Token': config.appToken,
      Authorization: `user_token ${config.userToken}`,
    },
  });
  if (!initRes.ok) {
    const text = await initRes.text().catch(() => '');
    throw new Error(`GLPI initSession failed (${initRes.status}): ${text}`);
  }
  const initJson = (await initRes.json()) as { session_token?: string };
  const sessionToken = initJson.session_token;
  if (!sessionToken) {
    throw new Error('GLPI initSession missing session_token');
  }

  try {
    return await fn(sessionToken, config);
  } finally {
    try {
      await fetchWithTimeout(`${config.baseUrl}/killSession`, {
        method: 'GET',
        headers: {
          'App-Token': config.appToken,
          'Session-Token': sessionToken,
        },
      });
    } catch {
      /* ignore killSession errors */
    }
  }
}

function sessionHeaders(config: GlpiConfig, sessionToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'App-Token': config.appToken,
    'Session-Token': sessionToken,
  };
}

function mapSearchRow(row: Record<string, unknown>): GlpiTicketSummary | null {
  const idRaw = row[String(FIELD_ID)] ?? row.id;
  const id = typeof idRaw === 'number' ? idRaw : Number(idRaw);
  if (!Number.isFinite(id)) return null;
  const titleRaw = row[String(FIELD_TITLE)] ?? row.name ?? '';
  const title = String(titleRaw);
  const status = row[String(FIELD_STATUS)];
  return {
    id,
    number: id,
    title,
    status: status as number | string | undefined,
  };
}

/**
 * Search open (not closed) tickets by title; numeric query also matches ID.
 */
export async function searchTickets(q: string): Promise<GlpiTicketSummary[]> {
  return withSession(async (sessionToken, config) => {
    const params = new URLSearchParams();
    params.set('range', '0-49');
    params.set('sort', String(FIELD_ID));
    params.set('order', 'DESC');
    params.append('forcedisplay[0]', String(FIELD_ID));
    params.append('forcedisplay[1]', String(FIELD_TITLE));
    params.append('forcedisplay[2]', String(FIELD_STATUS));

    // Not closed
    params.append('criteria[0][field]', String(FIELD_STATUS));
    params.append('criteria[0][searchtype]', 'notequals');
    params.append('criteria[0][value]', String(STATUS_CLOSED));

    const trimmed = q.trim();
    if (trimmed) {
      if (/^\d+$/.test(trimmed)) {
        params.append('criteria[1][link]', 'AND');
        params.append('criteria[1][field]', String(FIELD_ID));
        params.append('criteria[1][searchtype]', 'equals');
        params.append('criteria[1][value]', trimmed);
      } else {
        params.append('criteria[1][link]', 'AND');
        params.append('criteria[1][field]', String(FIELD_TITLE));
        params.append('criteria[1][searchtype]', 'contains');
        params.append('criteria[1][value]', trimmed);
      }
    }

    const res = await fetchWithTimeout(
      `${config.baseUrl}/search/Ticket?${params.toString()}`,
      { method: 'GET', headers: sessionHeaders(config, sessionToken) },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GLPI search failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as {
      data?: Array<Record<string, unknown>>;
    };
    const rows = json.data ?? [];
    return rows
      .map(mapSearchRow)
      .filter((t): t is GlpiTicketSummary => t != null);
  });
}

export async function getTicket(ticketId: number): Promise<GlpiTicketSummary> {
  return withSession(async (sessionToken, config) => {
    const res = await fetchWithTimeout(`${config.baseUrl}/Ticket/${ticketId}`, {
      method: 'GET',
      headers: sessionHeaders(config, sessionToken),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GLPI get ticket failed (${res.status}): ${text}`);
    }
    const ticket = (await res.json()) as {
      id?: number;
      name?: string;
      status?: number | string;
    };
    if (ticket.id == null) {
      throw new Error(`GLPI ticket ${ticketId} not found`);
    }
    return {
      id: ticket.id,
      number: ticket.id,
      title: ticket.name ?? `#${ticket.id}`,
      status: ticket.status,
    };
  });
}

/** Lookup by numeric id: search (open tickets) then direct GET. */
export async function resolveTicketByNumber(
  ticketNumber: string,
): Promise<GlpiTicketSummary> {
  const trimmed = ticketNumber.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error('Invalid ticket number');
  }

  const matches = await searchTickets(trimmed);
  const exact = matches.find((t) => String(t.id) === trimmed || String(t.number) === trimmed);
  if (exact) return exact;

  return getTicket(Number(trimmed));
}

export function glpiErrorMessage(err: unknown, ticketNumber?: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes('initSession failed') ||
    msg.includes('ERROR_GLPI_LOGIN') ||
    msg.includes('user_token') ||
    msg.includes('App-Token') ||
    msg.includes('GLPI config')
  ) {
    return (
      'No se pudo conectar con GLPI (credenciales o servicio).\n' +
      'Contactá administración para revisar viaticos/glpi-config en AWS.'
    );
  }
  if (ticketNumber) {
    return `No encontré el incidente #${ticketNumber} en GLPI. Verificá el número o tocá Omitir.`;
  }
  return 'Error al consultar GLPI. Intentá de nuevo o tocá Omitir.';
}

export async function addTicketFollowup(
  ticketId: number,
  content: string,
): Promise<number> {
  return withSession(async (sessionToken, config) => {
    const res = await fetchWithTimeout(`${config.baseUrl}/ITILFollowup`, {
      method: 'POST',
      headers: sessionHeaders(config, sessionToken),
      body: JSON.stringify({
        input: {
          itemtype: 'Ticket',
          items_id: ticketId,
          content,
          is_private: 0,
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GLPI followup failed (${res.status}): ${text}`);
    }
    const json = (await res.json()) as { id?: number };
    if (json.id == null) {
      throw new Error('GLPI followup response missing id');
    }
    return json.id;
  });
}
