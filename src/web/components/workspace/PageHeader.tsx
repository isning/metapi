import type { ReactNode } from 'react';

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export default function PageHeader({
  title,
  description,
  actions,
  className = '',
}: PageHeaderProps) {
  return (
    <header className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${className}`.trim()}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
