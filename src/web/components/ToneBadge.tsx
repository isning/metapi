import type { HTMLAttributes, ReactNode } from 'react';
import { Badge } from './ui/badge/index.js';

type ToneBadgeProps = Omit<HTMLAttributes<HTMLDivElement>, 'color'> & {
  tone?: string;
  children: ReactNode;
};

export default function ToneBadge({ tone = '', children, className, ...props }: ToneBadgeProps) {
  const variant = tone.includes('danger') || tone.includes('error')
    ? 'destructive'
    : tone.includes('warning')
      ? 'warning'
      : tone.includes('success')
        ? 'success'
        : tone.includes('info') || tone.includes('primary')
          ? 'default'
          : 'secondary';

  return (
    <Badge variant={variant} data-tone={tone} className={className} {...props}>
      {children}
    </Badge>
  );
}
