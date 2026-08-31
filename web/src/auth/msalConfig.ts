import { PublicClientApplication } from '@azure/msal-browser';

const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID;
const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID;

export const adminGroupId = import.meta.env.VITE_ENTRA_ADMIN_GROUP_ID;
export const supervisorGroupId = import.meta.env.VITE_ENTRA_SUPERVISOR_GROUP_ID;

export const msalInstance = new PublicClientApplication({
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'localStorage',
  },
  system: {
    // Allow silent iframe renew before redirect fallback
    allowRedirectInIframe: false,
  },
});

export const loginRequest = {
  // offline_access → refresh token so sessions can renew silently
  scopes: ['openid', 'profile', 'email', 'offline_access', 'User.Read'],
};

export const apiTokenRequest = {
  scopes: ['openid', 'profile', 'email', 'offline_access'],
};

export function isAdminFromClaims(
  claims: Record<string, unknown> | undefined,
): boolean {
  if (!claims) return false;
  const groups = claims.groups;
  if (Array.isArray(groups)) {
    return groups.includes(adminGroupId);
  }
  return false;
}
