import type { ReactNode } from 'react';

type EmptyStateBlockProps = {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
};

export default function EmptyStateBlock({
  icon,
  title,
  description,
  className = '',
}: EmptyStateBlockProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 p-8 text-center ${className}`.trim()}>
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <div className="text-sm font-semibold">{title}</div>
      {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
    </div>
  );
}
