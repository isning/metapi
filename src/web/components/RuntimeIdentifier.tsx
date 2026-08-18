import React from 'react';
import { cn } from '../lib/utils.js';
import { tr } from '../i18n.js';

export type RuntimeIdentifierKind =
  | 'execution-attempt'
  | 'route-endpoint'
  | 'route-entry'
  | 'fallback-stage'
  | 'runtime-artifact'
  | 'node'
  | 'identifier';

type RuntimeIdentifierProps = {
  value: string | number | null | undefined;
  kind?: RuntimeIdentifierKind;
  context?: React.ReactNode;
  className?: string;
  maxLength?: number;
};

const KNOWN_KINDS: RuntimeIdentifierKind[] = [
  'execution-attempt',
  'route-endpoint',
  'route-entry',
  'fallback-stage',
  'runtime-artifact',
  'node',
];

function inferKind(value: string): RuntimeIdentifierKind {
  const parts = value.split(':');
  const match = [...parts].reverse().find((part) => KNOWN_KINDS.includes(part as RuntimeIdentifierKind));
  return (match as RuntimeIdentifierKind | undefined) || 'identifier';
}

function shortIdentifier(value: string, kind: RuntimeIdentifierKind, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const parts = value.split(':');
  const tail = parts[parts.length - 1] || value;
  const tailLength = Math.max(6, Math.min(12, maxLength - kind.length - 5));
  return `${kind} · ${tail.slice(-tailLength)}`;
}

function runtimeKindLabel(kind: RuntimeIdentifierKind): string {
  switch (kind) {
    case 'execution-attempt': return tr('pages.proxyLogs.runtimeScopeExecutionAttempt');
    case 'route-endpoint': return tr('pages.proxyLogs.runtimeScopeEndpoint');
    case 'route-entry': return tr('pages.proxyLogs.runtimeScopeEntry');
    case 'fallback-stage': return tr('pages.proxyLogs.fallbackStages');
    case 'runtime-artifact': return tr('pages.proxyLogs.runtimeArtifactIdentity').replace(' {id}', '');
    case 'node': return tr('components.modelRouteFlow.nodeCount').replace(/\s*\d+$/, '');
    default: return '';
  }
}

export function formatRuntimeIdentifier(
  value: string | number | null | undefined,
  options: Pick<RuntimeIdentifierProps, 'kind' | 'maxLength'> = {},
): string {
  const normalized = value == null ? '' : String(value).trim();
  if (!normalized) return '-';
  const kind = options.kind || inferKind(normalized);
  return shortIdentifier(normalized, kind, options.maxLength || 56);
}

export default function RuntimeIdentifier({
  value,
  kind,
  context,
  className,
  maxLength = 56,
}: RuntimeIdentifierProps) {
  const normalized = value == null ? '' : String(value).trim();
  if (!normalized) return <span className={className}>-</span>;
  const resolvedKind = kind || inferKind(normalized);
  const display = shortIdentifier(normalized, resolvedKind, maxLength);
  const isShortened = display !== normalized;
  const shortenedTail = isShortened ? display.split(' · ').slice(-1)[0] : display;

  return (
    <span className={cn('runtime-identifier min-w-0 max-w-full', className)} title={normalized} aria-label={normalized} data-full-value={normalized}>
      {isShortened ? (
        <span className="runtime-identifier-shortened block min-w-0 max-w-full">
          <span className="runtime-identifier-kind block truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{runtimeKindLabel(resolvedKind)}</span>
          <span className="runtime-identifier-value block min-w-0 max-w-full truncate font-mono text-xs">{shortenedTail}</span>
        </span>
      ) : (
        <span className="runtime-identifier-value block min-w-0 max-w-full truncate font-mono text-xs">{display}</span>
      )}
      {context ? <span className="runtime-identifier-context block min-w-0 max-w-full truncate text-[11px] text-muted-foreground">{context}</span> : null}
    </span>
  );
}
