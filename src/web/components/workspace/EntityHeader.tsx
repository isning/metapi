import type { ReactNode } from 'react';

type EntityHeaderProps = {
  icon?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  badges?: ReactNode;
  metrics?: ReactNode;
  actions?: ReactNode;
};

export default function EntityHeader({
  icon,
  title,
  meta,
  badges,
  metrics,
  actions,
}: EntityHeaderProps) {
  return (
    <header className="border-b p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon ? <div className="shrink-0">{icon}</div> : null}
          <div className="min-w-0">
            <h1 className="min-w-0 truncate font-mono text-xl font-bold tracking-tight">{title}</h1>
            {meta ? <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">{meta}</div> : null}
          </div>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {badges ? <div className="mt-3 flex flex-wrap gap-1.5">{badges}</div> : null}
      {metrics ? <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{metrics}</div> : null}
    </header>
  );
}
