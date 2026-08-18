import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type ProxyLogClientOption,
  type ProxyRequestLog,
  type ProxyRequestLogDetail,
  type ProxyLogsSummary,
  type ProxyLogStatusFilter,
} from '../../api.js';

export type ProxyLogDetailState = {
  loading: boolean;
  data?: ProxyRequestLogDetail;
  error?: string;
  observedRevision?: string;
};

export function proxyRequestLogRevision(log: ProxyRequestLog): string {
  return JSON.stringify({
    status: log.status,
    httpStatus: log.httpStatus,
    completedAt: log.completedAt,
    finalExecutionAttemptId: log.finalExecutionAttemptId,
    debugTrace: log.debugTrace ? {
      id: log.debugTrace.id,
      updatedAt: log.debugTrace.updatedAt,
      selectedExecutionAttemptId: log.debugTrace.selectedExecutionAttemptId,
      finalStatus: log.debugTrace.finalStatus,
      finalHttpStatus: log.debugTrace.finalHttpStatus,
      finalUpstreamPath: log.debugTrace.finalUpstreamPath,
    } : null,
    attempts: log.attempts.map((attempt) => ({
      id: attempt.id,
      executionAttemptId: attempt.executionAttemptId,
      status: attempt.status,
      httpStatus: attempt.httpStatus,
      createdAt: attempt.createdAt,
    })),
  });
}

export type ProxyLogsWorkspaceQuery = {
  limit: number;
  offset: number;
  status: ProxyLogStatusFilter;
  search: string;
  client?: string;
  siteId?: number;
  from?: string;
  to?: string;
};

export type ProxyLogsWorkspaceSite = {
  id: number;
  name: string;
  status: string | null;
};

const EMPTY_SUMMARY: ProxyLogsSummary = {
  totalCount: 0,
  successCount: 0,
  failedCount: 0,
  cost: { amounts: [], knownObservationCount: 0, unknownObservationCount: 0 },
  totalTokensAll: 0,
};

export function useProxyLogsWorkspaceResource(input: {
  query: ProxyLogsWorkspaceQuery;
  hasInvalidTimeRange: boolean;
  onError?: (message: string) => void;
}) {
  const { query, hasInvalidTimeRange, onError } = input;
  const [logs, setLogs] = useState<ProxyRequestLog[]>([]);
  const [summary, setSummary] = useState<ProxyLogsSummary>(EMPTY_SUMMARY);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<ProxyLogsWorkspaceSite[]>([]);
  const [clientOptions, setClientOptions] = useState<ProxyLogClientOption[]>([]);
  const [detailById, setDetailById] = useState<Record<string, ProxyLogDetailState>>({});
  const detailByIdRef = useRef<Record<string, ProxyLogDetailState>>({});
  const detailLoadSeq = useRef<Record<string, number>>({});
  const loadSeq = useRef(0);
  const metaLoadSeq = useRef(0);

  const load = useCallback(async (silent = false) => {
    const seq = ++loadSeq.current;
    if (hasInvalidTimeRange) {
      setLogs([]);
      setTotal(0);
      setSummary(EMPTY_SUMMARY);
      if (seq === loadSeq.current) setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const data = await api.getProxyLogsQuery(query);
      if (seq !== loadSeq.current) return;
      setLogs(Array.isArray(data.items) ? data.items : []);
      setTotal(Number(data.total || 0));
    } catch (error: any) {
      if (seq === loadSeq.current && !silent) onError?.(error?.message || 'Failed to load proxy logs');
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [hasInvalidTimeRange, onError, query]);

  const loadMeta = useCallback(async (forceRefresh = false) => {
    const seq = ++metaLoadSeq.current;
    if (hasInvalidTimeRange) {
      setSummary(EMPTY_SUMMARY);
      setClientOptions([]);
      setSites([]);
      return;
    }
    try {
      const { limit: _limit, offset: _offset, ...metaQuery } = query;
      const data = await api.getProxyLogsMeta({ ...metaQuery, ...(forceRefresh ? { refresh: 1 } : {}) });
      if (seq !== metaLoadSeq.current) return;
      setSummary(data.summary || EMPTY_SUMMARY);
      setClientOptions(Array.isArray(data.clientOptions) ? data.clientOptions : []);
      setSites((Array.isArray(data.sites) ? data.sites : [])
        .map((site: any) => ({
          id: Number(site?.id || 0),
          name: String(site?.name || '').trim() || `站点 #${site?.id ?? ''}`,
          status: typeof site?.status === 'string' ? site.status : null,
        }))
        .filter((site: ProxyLogsWorkspaceSite) => site.id > 0)
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')));
    } catch (error) {
      if (seq === metaLoadSeq.current) console.error('Failed to load proxy log meta:', error);
    }
  }, [hasInvalidTimeRange, query]);

  const loadDetail = useCallback(async (
    id: string,
    options?: {
      force?: boolean;
      observedRevision?: string;
      preserveVisibleData?: boolean;
    },
  ) => {
    const existing = detailByIdRef.current[id];
    if (existing?.loading || (!options?.force && existing?.data)) return;
    const seq = (detailLoadSeq.current[id] || 0) + 1;
    detailLoadSeq.current[id] = seq;
    setDetailById((current) => ({
      ...current,
      [id]: {
        ...(options?.preserveVisibleData ? current[id] : {}),
        loading: true,
        observedRevision: options?.observedRevision,
      },
    }));
    try {
      const data = await api.getProxyRequestLogDetail(id);
      if (detailLoadSeq.current[id] !== seq) return;
      setDetailById((current) => ({
        ...current,
        [id]: {
          loading: false,
          data,
          observedRevision: options?.observedRevision,
        },
      }));
    } catch (error: any) {
      if (detailLoadSeq.current[id] !== seq) return;
      const message = error?.message || 'Failed to load log details';
      setDetailById((current) => ({
        ...current,
        [id]: {
          loading: false,
          error: message,
          observedRevision: options?.observedRevision,
        },
      }));
      onError?.(message);
    }
  }, [onError]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadMeta(); }, [loadMeta]);
  useEffect(() => {
    detailByIdRef.current = detailById;
  }, [detailById]);

  return { logs, summary, total, loading, sites, clientOptions, detailById, load, loadMeta, loadDetail };
}
