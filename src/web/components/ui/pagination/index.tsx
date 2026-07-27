import * as React from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { Button, type ButtonProps } from '../button/index.js';

const Pagination = ({ className, ...props }: React.ComponentProps<'nav'>) => (
  <nav
    role="navigation"
    aria-label="pagination"
    className={cn('mx-auto flex w-full justify-center', className)}
    {...props}
  />
);
Pagination.displayName = 'Pagination';

const PaginationContent = React.forwardRef<HTMLUListElement, React.ComponentProps<'ul'>>(
  ({ className, ...props }, ref) => (
    <ul ref={ref} className={cn('flex flex-row items-center gap-1', className)} {...props} />
  ),
);
PaginationContent.displayName = 'PaginationContent';

const PaginationItem = React.forwardRef<HTMLLIElement, React.ComponentProps<'li'>>(
  ({ className, ...props }, ref) => <li ref={ref} className={cn('', className)} {...props} />,
);
PaginationItem.displayName = 'PaginationItem';

type PaginationLinkProps = Omit<ButtonProps, 'variant'> & {
  isActive?: boolean;
};

const PaginationLink = React.forwardRef<HTMLButtonElement, PaginationLinkProps>(
  ({ className, isActive, size = 'icon', ...props }, ref) => (
    <Button
      ref={ref}
      variant={isActive ? 'secondary' : 'outline'}
      size={size}
      aria-current={isActive ? 'page' : undefined}
      className={className}
      {...props}
    />
  ),
);
PaginationLink.displayName = 'PaginationLink';

const PaginationPrevious = React.forwardRef<HTMLButtonElement, Omit<PaginationLinkProps, 'children'>>(
  ({ className, ...props }, ref) => (
    <PaginationLink ref={ref} aria-label="Go to previous page" className={className} {...props}>
      <ChevronLeft />
    </PaginationLink>
  ),
);
PaginationPrevious.displayName = 'PaginationPrevious';

const PaginationNext = React.forwardRef<HTMLButtonElement, Omit<PaginationLinkProps, 'children'>>(
  ({ className, ...props }, ref) => (
    <PaginationLink ref={ref} aria-label="Go to next page" className={className} {...props}>
      <ChevronRight />
    </PaginationLink>
  ),
);
PaginationNext.displayName = 'PaginationNext';

const PaginationEllipsis = ({ className, ...props }: React.ComponentProps<'span'>) => (
  <span
    aria-hidden
    className={cn('flex h-8 w-8 items-center justify-center', className)}
    {...props}
  >
    <MoreHorizontal className="size-4" />
    <span className="sr-only">More pages</span>
  </span>
);
PaginationEllipsis.displayName = 'PaginationEllipsis';

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
};
