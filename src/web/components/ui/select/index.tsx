import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { popoverMotionClassName } from '../motion.js';

type SelectFallbackContextValue = {
  fallback: boolean;
  open: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

const SelectFallbackContext = React.createContext<SelectFallbackContextValue | null>(null);

function shouldRenderInlineSelectFallback() {
  return typeof document === 'undefined'
    || !document.body
    || typeof document.body.querySelector !== 'function';
}

const Select = ({
  value,
  defaultValue,
  onValueChange,
  disabled,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Root>) => {
  const [open, setOpen] = React.useState(false);
  const fallback = shouldRenderInlineSelectFallback();
  const contextValue = React.useMemo<SelectFallbackContextValue>(() => ({
    fallback,
    open,
    value: value ?? defaultValue,
    onValueChange,
    disabled,
    setOpen,
  }), [defaultValue, disabled, fallback, onValueChange, open, value]);

  if (fallback) {
    return (
      <SelectFallbackContext.Provider value={contextValue}>
        <div className="relative grid gap-1" data-slot="select">
          {children}
        </div>
      </SelectFallbackContext.Provider>
    );
  }

  return (
    <SelectFallbackContext.Provider value={contextValue}>
      <SelectPrimitive.Root
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        disabled={disabled}
        {...props}
      >
        {children}
      </SelectPrimitive.Root>
    </SelectFallbackContext.Provider>
  );
};
const SelectGroup = SelectPrimitive.Group;
const SelectValue = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Value>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Value>
>((props, ref) => {
  const context = React.useContext(SelectFallbackContext);
  if (context?.fallback) {
    return <span ref={ref as React.Ref<HTMLSpanElement>} {...props} />;
  }
  return <SelectPrimitive.Value ref={ref} {...props} />;
});
SelectValue.displayName = SelectPrimitive.Value.displayName;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => {
  const context = React.useContext(SelectFallbackContext);
  const triggerClassName = cn('flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-offset-background placeholder:text-muted-foreground focus:ring-1 focus:ring-inset focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1', className);
  if (context?.fallback) {
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        role="combobox"
        aria-expanded={context.open}
        disabled={context.disabled}
        className={triggerClassName}
        onClick={() => context.setOpen((current) => !current)}
        {...props}
      >
        {children}
        <ChevronDown className="size-4 opacity-50" />
      </button>
    );
  }
  return (
    <SelectPrimitive.Trigger ref={ref} className={triggerClassName} {...props}>
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton ref={ref} className={cn('flex cursor-default items-center justify-center py-1', className)} {...props}>
    <ChevronUp className="size-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton ref={ref} className={cn('flex cursor-default items-center justify-center py-1', className)} {...props}>
    <ChevronDown className="size-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => {
  const context = React.useContext(SelectFallbackContext);
  const contentClassName = cn('relative z-50 max-h-96 min-w-32 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md', popoverMotionClassName, position === 'popper' && 'translate-y-1', className);
  if (context?.fallback) {
    if (!context.open) return null;
    return (
      <div ref={ref as React.Ref<HTMLDivElement>} className={contentClassName} {...props}>
        <div className="p-1">{children}</div>
      </div>
    );
  }
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content ref={ref} className={contentClassName} position={position} {...props}>
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport className={cn('p-1', position === 'popper' && 'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]')}>
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label ref={ref} className={cn('px-2 py-1.5 text-sm font-semibold', className)} {...props} />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => {
  const context = React.useContext(SelectFallbackContext);
  const itemClassName = cn('relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50', className);
  if (context?.fallback) {
    const value = String(props.value);
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        role="option"
        className={itemClassName}
        disabled={props.disabled}
        onClick={() => {
          if (props.disabled) return;
          context.onValueChange?.(value);
          context.setOpen(false);
        }}
      >
        <span className="absolute right-2 flex size-3.5 items-center justify-center">
          {context.value === value ? <Check className="size-4" /> : null}
        </span>
        {children}
      </button>
    );
  }
  return (
    <SelectPrimitive.Item ref={ref} className={itemClassName} {...props}>
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
});
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-muted', className)} {...props} />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
};
