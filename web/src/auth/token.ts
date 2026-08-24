import {
  InteractionRequiredAuthError,
  type AccountInfo,
  type IPublicClientApplication,
} from '@azure/msal-browser';
import { apiTokenRequest, loginRequest } from './msalConfig';

const SKEW_SECONDS = 5 * 60; // refresh 5 min before expiry

function tokenExpiresSoon(idTokenClaims: AccountInfo['idTokenClaims']): boolean {
  const exp = idTokenClaims?.exp;
  if (typeof exp !== 'number') return true;
  const now = Math.floor(Date.now() / 1000);
  return exp <= now + SKEW_SECONDS;
}

function resolveAccount(
  instance: IPublicClientApplication,
): AccountInfo | null {
  const active = instance.getActiveAccount();
  if (active) return active;
  const accounts = instance.getAllAccounts();
  if (accounts.length === 0) return null;
  instance.setActiveAccount(accounts[0]);
  return accounts[0];
}

/**
 * Returns a fresh ID token for the admin API (aud = SPA clientId).
 * Silently refreshes when expired / near expiry; redirects to login if needed.
 */
export async function acquireApiIdToken(
  instance: IPublicClientApplication,
  options?: { forceRefresh?: boolean },
): Promise<string> {
  const account = resolveAccount(instance);
  if (!account) {
    await instance.loginRedirect(loginRequest);
    throw new Error('Redirecting to login');
  }

  const forceRefresh =
    options?.forceRefresh === true || tokenExpiresSoon(account.idTokenClaims);

  try {
    const result = await instance.acquireTokenSilent({
      ...apiTokenRequest,
      account,
      forceRefresh,
    });
    if (!result.idToken) {
      throw new Error('Silent acquire returned empty idToken');
    }
    instance.setActiveAccount(result.account ?? account);
    return result.idToken;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      await instance.acquireTokenRedirect({
        ...apiTokenRequest,
        account,
      });
      throw new Error('Redirecting to renew session');
    }
    // Last resort: full login
    await instance.loginRedirect(loginRequest);
    throw new Error('Redirecting to login');
  }
}
