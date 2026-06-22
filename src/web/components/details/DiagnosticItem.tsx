import type { ReactNode } from 'react';
import { AlertTriangle, Info, XCircle } from 'lucide-react';
import { Badge } from '../ui/badge/index.js';
import { Button } from '../ui/button/index.js';

type DiagnosticLevel = 'info' | 'warn' | 'error';

type DiagnosticItemProps = {
  level: DiagnosticLevel;
  message: ReactNode;
  detail?: ReactNode;
  onGoToTarget?: () => void;
};

const levelIcon = {
  info: <Info className="size-4" />,
  warn: <AlertTriangle className="size-4" />,
  error: <XCircle className="size-4" />,
};

const levelVariant = {
  info: 'secondary',
  warn: 'warning',
  error: 'destructive',
} as const;

export default function DiagnosticItem({
  level,
  message,
  detail,
  onGoToTarget,
}: DiagnosticItemProps) {
  return (
    <div className="flex items-start gap-2 rounded-md border p-3">
      <span className="mt-0.5 inline-flex shrink-0 text-muted-foreground">{levelIcon[level]}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={levelVariant[level]}>{level}</Badge>
          <div className="min-w-0 text-sm font-medium">{message}</div>
        </div>
        {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
      </div>
      {onGoToTarget ? (
        <Button type="button" variant="outline" size="sm" onClick={onGoToTarget}>
          Go to node
        </Button>
      ) : null}
    </div>
  );
}
