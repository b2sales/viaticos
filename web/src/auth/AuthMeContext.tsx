import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useIsAuthenticated } from '@azure/msal-react';
import { useApi } from '../api/useApi';
import type { MeResponse, RoleCapabilities } from '../types';

const EMPTY_CAPS: RoleCapabilities = {
  canApprove: false,
  canLiquidate: false,
  canManageMasters: false,
  canManageTeam: false,
  canConfigureRoles: false,
};

interface AuthMeContextValue {
  me: MeResponse | null;
  loading: boolean;
  error: string | null;
  capabilities: RoleCapabilities;
  refresh: () => Promise<void>;
}

const AuthMeContext = createContext<AuthMeContextValue | null>(null);

export function AuthMeProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const isAuthenticated = useIsAuthenticated();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setMe(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<MeResponse>('/me');
      setMe(data);
    } catch (err) {
      setMe(null);
      setError(err instanceof Error ? err.message : 'Sin permiso');
    } finally {
      setLoading(false);
    }
  }, [api, isAuthenticated]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      me,
      loading,
      error,
      capabilities: me?.capabilities ?? EMPTY_CAPS,
      refresh,
    }),
    [me, loading, error, refresh],
  );

  return (
    <AuthMeContext.Provider value={value}>{children}</AuthMeContext.Provider>
  );
}

export function useAuthMe(): AuthMeContextValue {
  const ctx = useContext(AuthMeContext);
  if (!ctx) {
    throw new Error('useAuthMe must be used within AuthMeProvider');
  }
  return ctx;
}
