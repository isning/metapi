import type { ReactNode } from 'react';

type MetricGridProps = {
  children: ReactNode;
};

export default function MetricGrid({ children }: MetricGridProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {children}
    </div>
  );
}
