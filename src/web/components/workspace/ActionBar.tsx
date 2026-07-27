import { forwardRef, type ComponentType, type ReactNode } from 'react';
import { ArrowUpDown, GripVertical, LoaderCircle, Plus, X } from 'lucide-react';
import ModernSelect from '../ModernSelect.js';
import { Button, type ButtonProps } from '../ui/button/index.js';
import { cn } from '../../lib/utils.js';

type ActionIcon = ComponentType<{ className?: string }>;

type PageActionBarProps = {
  children: ReactNode;
  className?: string;
};

export function PageActionBar({ children, className }: PageActionBarProps) {
  return (
    <div className={cn('flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end', className)}>
      {children}
    </div>
  );
}

type CreateActionButtonProps = Omit<ButtonProps, 'children'> & {
  active?: boolean;
  label: ReactNode;
  activeLabel?: ReactNode;
  icon?: ActionIcon;
  activeIcon?: ActionIcon;
};

export function CreateActionButton({
  active = false,
  label,
  activeLabel,
  icon: Icon = Plus,
  activeIcon: ActiveIcon = X,
  variant,
  className,
  ...props
}: CreateActionButtonProps) {
  const DisplayIcon = active ? ActiveIcon : Icon;
  return (
    <Button
      variant={active ? 'outline' : (variant ?? 'default')}
      className={cn('shrink-0', className)}
      {...props}
    >
      <DisplayIcon className="size-4" />
      {active ? (activeLabel ?? label) : label}
    </Button>
  );
}

type SecondaryActionButtonProps = Omit<ButtonProps, 'children'> & {
  icon?: ActionIcon;
  loading?: boolean;
  loadingLabel?: ReactNode;
  children: ReactNode;
};

export function SecondaryActionButton({
  icon: Icon,
  loading = false,
  loadingLabel,
  children,
  variant = 'outline',
  className,
  ...props
}: SecondaryActionButtonProps) {
  return (
    <Button variant={variant} className={cn('shrink-0', className)} {...props}>
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : Icon ? <Icon className="size-4" /> : null}
      {loading ? (loadingLabel ?? children) : children}
    </Button>
  );
}

type SortModeOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

type SortModeControlProps = {
  value: string;
  onChange: (value: string) => void;
  options: SortModeOption[];
  placeholder: string;
  className?: string;
  selectClassName?: string;
  disabled?: boolean;
};

export function SortModeControl({
  value,
  onChange,
  options,
  placeholder,
  className,
  selectClassName,
  disabled,
}: SortModeControlProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <div className="grid size-8 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground">
        <ArrowUpDown className="size-4" />
      </div>
      <ModernSelect
        size="sm"
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        className={cn('min-w-40', selectClassName)}
      />
    </div>
  );
}

type TableActionBarProps = {
  children: ReactNode;
  className?: string;
};

export function TableActionBar({ children, className }: TableActionBarProps) {
  return (
    <div className={cn('flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end', className)}>
      {children}
    </div>
  );
}

type DragHandleButtonProps = Omit<ButtonProps, 'children' | 'variant' | 'size'> & {
  loading?: boolean;
};

export const DragHandleButton = forwardRef<HTMLButtonElement, DragHandleButtonProps>(({
  loading = false,
  className,
  ...props
}, ref) => (
  <Button
    ref={ref}
    type="button"
    variant="outline"
    size="icon"
    className={cn('cursor-grab text-muted-foreground disabled:cursor-not-allowed', className)}
    {...props}
  >
    {loading ? <LoaderCircle className="size-4 animate-spin" /> : <GripVertical className="size-4" />}
  </Button>
));
DragHandleButton.displayName = 'DragHandleButton';
