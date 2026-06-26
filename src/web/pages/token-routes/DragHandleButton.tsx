import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Button } from '../../components/ui/button/index.js';
import { cn } from '../../lib/utils.js';

type DragHandleButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: ReactNode;
};

const DefaultGrip = () => (
  <svg width="12" height="12" fill="currentColor" viewBox="0 0 12 12" aria-hidden>
    <circle cx="3" cy="2" r="1" />
    <circle cx="9" cy="2" r="1" />
    <circle cx="3" cy="6" r="1" />
    <circle cx="9" cy="6" r="1" />
    <circle cx="3" cy="10" r="1" />
    <circle cx="9" cy="10" r="1" />
  </svg>
);

export const DragHandleButton = forwardRef<HTMLButtonElement, DragHandleButtonProps>(({
  children,
  className,
  type = 'button',
  ...props
}, ref) => (
  <Button
    ref={ref}
    type={type}
    variant="outline"
    size="icon"
    className={cn('cursor-grab disabled:cursor-not-allowed', className)}
    {...props}
  >
    {children ?? <DefaultGrip />}
  </Button>
));

DragHandleButton.displayName = 'DragHandleButton';
