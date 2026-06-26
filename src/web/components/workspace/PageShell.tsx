import type { ReactNode } from 'react';

type PageShellProps = {
  children: ReactNode;
  className?: string;
};

export default function PageShell({
  children,
  className = '',
}: PageShellProps) {
  return (
    <div className={`grid animate-fade-in gap-4 ${className}`.trim()}>
      {children}
    </div>
  );
}
