import type { ReactNode } from 'react';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyIcon,
  EmptyTitle,
} from './ui/empty/index.js';

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
    <Empty className={className}>
      <EmptyHeader>
        {icon ? <EmptyIcon>{icon}</EmptyIcon> : null}
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  );
}
