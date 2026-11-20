import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from './api';

/** List state (page, search, sort, filters) kept in the URL so it survives reloads and can be shared. */
export function useListParams(defaults: Record<string, string> = {}) {
  const [sp, setSp] = useSearchParams();
  const get = (k: string) => sp.get(k) ?? defaults[k] ?? '';
  const params = useMemo(() => {
    const o: Record<string, string> = { ...defaults };
    sp.forEach((v, k) => (o[k] = v));
    return o;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);
  const set = useCallback(
    (patch: Record<string, string | undefined>, resetPage = true) => {
      setSp((prev) => {
        const n = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) (v ? n.set(k, v) : n.delete(k));
        if (resetPage && !('page' in patch)) n.delete('page');
        return n;
      }, { replace: true });
    },
    [setSp],
  );
  const toggleSort = (key: string) => {
    const same = get('sort') === key;
    set({ sort: key, dir: same && get('dir') === 'asc' ? 'desc' : 'asc' });
  };
  return { params, get, set, toggleSort, page: Number(get('page') || 1) };
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Mutation with success/error toasts and cache invalidation. */
export function useAction<TVars, TRes = unknown>(
  fn: (v: TVars) => Promise<TRes>,
  opts: { success?: string | ((r: TRes) => string); invalidate?: QueryKey[]; onSuccess?: (r: TRes) => void; onFieldErrors?: (f: Record<string, string>) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      opts.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      opts.onSuccess?.(r);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) opts.onFieldErrors?.(e.fields);
      toast.error(e instanceof Error ? e.message : 'Something went wrong');
    },
  });
}

/** Simple controlled form state with server-side field errors. */
export function useForm<T extends Record<string, unknown>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const bind = (name: keyof T & string) => ({
    id: name,
    name,
    value: (values[name] ?? '') as string,
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
    onChange: (e: { target: { value: string } }) => {
      setValues((v) => ({ ...v, [name]: e.target.value }));
      if (errors[name]) setErrors(({ [name]: _, ...rest }) => rest);
    },
  });
  return { values, setValues, errors, setErrors, bind, set: (k: keyof T, v: unknown) => setValues((p) => ({ ...p, [k]: v })) };
}
