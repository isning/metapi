import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '../../../lib/utils.js';

function shouldRenderInlineSwitchFallback() {
  return typeof document === 'undefined'
    || !document.body
    || typeof document.body.querySelector !== 'function';
}

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, checked, defaultChecked, onCheckedChange, disabled, ...props }, ref) => {
  const rootClassName = cn(
    'relative inline-flex h-6 w-10 shrink-0 items-center cursor-pointer rounded-full border border-input bg-input transition-colors data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50',
    className,
  );

  if (shouldRenderInlineSwitchFallback()) {
    const resolvedChecked = checked ?? defaultChecked ?? false;
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        role="switch"
        aria-checked={resolvedChecked}
        data-state={resolvedChecked ? 'checked' : 'unchecked'}
        disabled={disabled}
        className={rootClassName}
        onClick={() => {
          if (disabled) return;
          onCheckedChange?.(!resolvedChecked);
        }}
        {...props}
      >
        <span
          className="block h-5 w-5 translate-x-0.5 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-[18px]"
          data-state={resolvedChecked ? 'checked' : 'unchecked'}
        />
      </button>
    );
  }

  return (
    <SwitchPrimitive.Root
      ref={ref}
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={rootClassName}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
});
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
