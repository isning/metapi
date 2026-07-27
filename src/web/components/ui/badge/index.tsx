import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../../lib/utils.js';

const badgeVariants = cva('inline-flex max-w-full items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold transition-colors', {
  variants: {
    variant: {
      default: 'border-primary/20 bg-primary/10 text-primary [a&]:hover:bg-primary/15',
      secondary: 'border-border bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/80',
      destructive: 'border-destructive/20 bg-destructive/10 text-destructive [a&]:hover:bg-destructive/15',
      outline: 'border-border bg-transparent text-foreground',
      success: 'border-success/20 bg-success/10 text-success [a&]:hover:bg-success/15',
      warning: 'border-warning/20 bg-warning/10 text-warning [a&]:hover:bg-warning/15',
      info: 'border-info/20 bg-info/10 text-info [a&]:hover:bg-info/15',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export type BadgeProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
