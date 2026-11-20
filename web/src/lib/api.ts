// Thin fetch wrapper. The access token lives in memory only; the refresh token
// is an httpOnly cookie the browser sends to /api/auth/refresh.

export class ApiError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string>) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onAuthLost: (() => void) | null = null;

export const setAccessToken = (t: string | null) => { accessToken = t; };
export const setOnAuthLost = (fn: () => void) => { onAuthLost = fn; };

export async function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then(async (r) => {
      if (!r.ok) return false;
      const data = await r.json();
      accessToken = data.accessToken;
      return true;
    })
    .catch(() => false)
    .finally(() => { setTimeout(() => (refreshing = null), 0); });
  return refreshing;
}

type Body = Record<string, unknown> | FormData | undefined;

async function request<T>(method: string, path: string, body?: Body, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const isForm = body instanceof FormData;
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  if (res.status === 401 && retry && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
    if (await refreshSession()) return request<T>(method, path, body, false);
    onAuthLost?.();
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    let fields: Record<string, string> | undefined;
    try {
      const data = await res.json();
      msg = data.error ?? msg;
      fields = data.fields ?? data.details?.fields;
    } catch { /* not JSON */ }
    throw new ApiError(res.status, msg, fields);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('json') ? res.json() : res.blob()) as Promise<T>;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: Body) => request<T>('POST', p, b),
  patch: <T>(p: string, b?: Body) => request<T>('PATCH', p, b),
  put: <T>(p: string, b?: Body) => request<T>('PUT', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
};

/** Fetch a protected file and return an object URL usable in <img>/<a>. */
export async function fileUrl(path: string) {
  const blob = await request<Blob>('GET', path);
  return URL.createObjectURL(blob);
}

export async function download(path: string, filename: string) {
  const url = await fileUrl(path);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function qs(params: Record<string, unknown>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}
