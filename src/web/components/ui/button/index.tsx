import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../../lib/utils.js';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap border text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4',
  {
  variants: {
    variant: {
      default: 'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
      destructive: 'border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90',
      softSuccess: 'border-success/20 bg-success/10 text-success hover:bg-success/15',
      softDestructive: 'border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive/15',
      outline: 'border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
      secondary: 'border-secondary bg-secondary text-secondary-foreground hover:bg-secondary/80',
      ghost: 'border-transparent bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground',
      ghostPrimary: 'border-transparent bg-transparent text-primary hover:bg-accent hover:text-primary',
      ghostMuted: 'border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-muted-foreground',
      ghostWarning: 'border-transparent bg-transparent text-warning hover:bg-accent hover:text-warning',
      ghostDestructive: 'border-transparent bg-transparent text-destructive hover:bg-accent hover:text-destructive',
    },
    size: {
      default: 'h-9 rounded-md px-3',
      sm: 'h-8 rounded-md px-2.5 text-xs',
      icon: 'h-8 w-8 rounded-md p-0',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & {
  asChild?: boolean;
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ asChild = false, className, variant, size, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = 'Button';

export { Button, buttonVariants };
