import { loadEntraConfig } from './entra.js';

export interface EntraGroupMember {
  oid: string;
  name: string;
  email?: string;
}

interface GraphMembersPage {
  value?: Array<{
    id?: string;
    displayName?: string;
    mail?: string | null;
    userPrincipalName?: string | null;
  }>;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedToken: { token: string; expiresAt: number } | undefined;
let cachedSupervisors: { at: number; items: EntraGroupMember[] } | undefined;

async function fetchGraphToken(config: {
  tenantId: string;
  clientId: string;
  clientSecret?: string;
}): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }
  if (!config.clientSecret) {
    throw new Error(
      'Entra config missing clientSecret. Para apps SPA usá Graph desde el navegador (GroupMember.Read.All delegado).',
    );
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph token request failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error('Graph token response missing access_token');
  }

  cachedToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

export async function listSupervisorGroupMembers(
  secretName?: string,
): Promise<EntraGroupMember[]> {
  const now = Date.now();
  if (cachedSupervisors && now - cachedSupervisors.at < CACHE_TTL_MS) {
    return cachedSupervisors.items;
  }

  const config = await loadEntraConfig(secretName);
  if (!config.supervisorGroupId) {
    return [];
  }

  const token = await fetchGraphToken(config);
  const url = new URL(
    `https://graph.microsoft.com/v1.0/groups/${config.supervisorGroupId}/members/microsoft.graph.user`,
  );
  url.searchParams.set('$select', 'id,displayName,mail,userPrincipalName');

  const items: EntraGroupMember[] = [];
  let nextUrl: string | undefined = url.toString();

  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Graph members request failed (${res.status}): ${text}`);
    }
    const page = (await res.json()) as GraphMembersPage & {
      '@odata.nextLink'?: string;
    };
    for (const member of page.value ?? []) {
      if (!member.id) continue;
      items.push({
        oid: member.id,
        name: member.displayName ?? member.userPrincipalName ?? member.id,
        email: member.mail ?? member.userPrincipalName ?? undefined,
      });
    }
    nextUrl = page['@odata.nextLink'];
  }

  items.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  cachedSupervisors = { at: now, items };
  return items;
}
