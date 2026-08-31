import {
  InteractionRequiredAuthError,
  type IPublicClientApplication,
} from '@azure/msal-browser';
import type { EntraSupervisor } from '../types';
import { supervisorGroupId } from './msalConfig';

// GroupMember.Read.All lista miembros; User.ReadBasic.All permite leer displayName/mail de otros usuarios.
const GRAPH_SCOPES = ['GroupMember.Read.All', 'User.ReadBasic.All'];

interface GraphMember {
  id?: string;
  displayName?: string | null;
  mail?: string | null;
  userPrincipalName?: string | null;
}

async function acquireGraphToken(
  instance: IPublicClientApplication,
  account: NonNullable<ReturnType<IPublicClientApplication['getActiveAccount']>>,
): Promise<string> {
  try {
    const result = await instance.acquireTokenSilent({
      scopes: GRAPH_SCOPES,
      account,
    });
    if (!result.accessToken) {
      throw new Error('Token Graph vacío');
    }
    return result.accessToken;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      const result = await instance.acquireTokenPopup({
        scopes: GRAPH_SCOPES,
        account,
      });
      if (!result.accessToken) {
        throw new Error('Token Graph vacío');
      }
      return result.accessToken;
    }
    throw err;
  }
}

function memberName(member: GraphMember): string | undefined {
  return member.displayName ?? member.userPrincipalName ?? undefined;
}

async function enrichUserProfile(
  accessToken: string,
  userId: string,
): Promise<GraphMember | null> {
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${userId}?$select=id,displayName,mail,userPrincipalName`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) return null;
  return (await response.json()) as GraphMember;
}

export async function fetchSupervisorsFromGraph(
  instance: IPublicClientApplication,
): Promise<EntraSupervisor[]> {
  if (!supervisorGroupId) {
    throw new Error('VITE_ENTRA_SUPERVISOR_GROUP_ID no configurado');
  }

  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) {
    throw new Error('No hay sesión activa');
  }

  const accessToken = await acquireGraphToken(instance, account);

  const items: EntraSupervisor[] = [];
  let url: string | null =
    `https://graph.microsoft.com/v1.0/groups/${supervisorGroupId}/members/microsoft.graph.user` +
    '?$select=id,displayName,mail,userPrincipalName';

  while (url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Graph members (${response.status}): ${text.slice(0, 200)}`);
    }
    const page = (await response.json()) as {
      value?: GraphMember[];
      '@odata.nextLink'?: string;
    };
    for (const member of page.value ?? []) {
      if (!member.id) continue;

      let profile = member;
      if (!memberName(member)) {
        const enriched = await enrichUserProfile(accessToken, member.id);
        if (enriched) profile = enriched;
      }

      const oid = profile.id!.toLowerCase();
      items.push({
        oid,
        name: memberName(profile) ?? oid,
        email: profile.mail ?? profile.userPrincipalName ?? undefined,
      });
    }
    url = page['@odata.nextLink'] ?? null;
  }

  items.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return items;
}
