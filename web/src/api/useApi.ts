import { useMsal } from '@azure/msal-react';
import { useCallback, useMemo } from 'react';
import { acquireApiIdToken } from '../auth/token';

const API_BASE = import.meta.env.VITE_API_BASE.replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function useApi() {
  const { instance, accounts } = useMsal();
  const accountKey = accounts[0]?.homeAccountId ?? '';

  const getToken = useCallback(
    async (forceRefresh = false): Promise<string> => {
      return acquireApiIdToken(instance, { forceRefresh });
    },
    [instance, accountKey],
  );

  const request = useCallback(
    async <T>(
      path: string,
      options: RequestInit = {},
      retried = false,
    ): Promise<T> => {
      const token = await getToken(retried);
      const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
      const response = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      // Expired / revoked token → force refresh once and retry
      if (response.status === 401 && !retried) {
        return request<T>(path, options, true);
      }

      if (!response.ok) {
        let message = response.statusText;
        try {
          const body = (await response.json()) as { error?: string };
          message = body.error ?? message;
        } catch {
          /* ignore */
        }
        throw new ApiError(response.status, message);
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        return (await response.json()) as T;
      }
      return (await response.text()) as T;
    },
    [getToken],
  );

  const get = useCallback(
    <T>(path: string) => request<T>(path),
    [request],
  );

  const post = useCallback(
    <T>(path: string, body?: unknown) =>
      request<T>(path, {
        method: 'POST',
        body: body != null ? JSON.stringify(body) : undefined,
      }),
    [request],
  );

  const put = useCallback(
    <T>(path: string, body: unknown) =>
      request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
    [request],
  );

  const patch = useCallback(
    <T>(path: string, body: unknown) =>
      request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
    [request],
  );

  const del = useCallback(
    <T>(path: string) => request<T>(path, { method: 'DELETE' }),
    [request],
  );

  const download = useCallback(
    async (path: string, filename: string) => {
      const doFetch = async (forceRefresh: boolean) => {
        const token = await getToken(forceRefresh);
        const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
        return fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
      };

      let response = await doFetch(false);
      if (response.status === 401) {
        response = await doFetch(true);
      }
      if (!response.ok) throw new ApiError(response.status, 'Error al descargar');
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    },
    [getToken],
  );

  return useMemo(
    () => ({ get, post, put, patch, delete: del, download }),
    [get, post, put, patch, del, download],
  );
}
