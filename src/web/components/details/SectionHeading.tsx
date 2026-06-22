import type { ReactNode } from 'react';

type SectionHeadingProps = {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
};

export default function SectionHeading({
  title,
  description,
  icon,
  action,
}: SectionHeadingProps) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-start gap-2">
        {icon ? <span className="mt-0.5 inline-flex shrink-0 text-muted-foreground">{icon}</span> : null}
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
