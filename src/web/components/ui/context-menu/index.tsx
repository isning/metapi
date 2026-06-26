import * as React from 'react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { Check, ChevronRight, Circle } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { popoverMotionClassName } from '../motion.js';

const Root = ContextMenuPrimitive.Root;
const Trigger = ContextMenuPrimitive.Trigger;
const Group = ContextMenuPrimitive.Group;
const Portal = ContextMenuPrimitive.Portal;
const Sub = ContextMenuPrimitive.Sub;
const RadioGroup = ContextMenuPrimitive.RadioGroup;

const SubTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & { inset?: boolean }
>(({ className, inset, children, ...props }, ref) => (
  <ContextMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      'flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      inset && 'pl-7',
      className,
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto size-3.5" />
  </ContextMenuPrimitive.SubTrigger>
));
SubTrigger.displayName = ContextMenuPrimitive.SubTrigger.displayName;

const SubContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.SubContent ref={ref} className={cn('z-50 min-w-32 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg', popoverMotionClassName, className)} {...props} />
  </ContextMenuPrimitive.Portal>
));
SubContent.displayName = ContextMenuPrimitive.SubContent.displayName;

const Content = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn('z-50 max-h-[var(--radix-context-menu-content-available-height)] min-w-32 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md', popoverMotionClassName, className)}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
));
Content.displayName = ContextMenuPrimitive.Content.displayName;

const Item = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & { inset?: boolean; variant?: 'default' | 'destructive' }
>(({ className, inset, variant = 'default', ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      inset && 'pl-7',
      variant === 'destructive' && 'text-destructive focus:bg-destructive focus:text-destructive-foreground',
      className,
    )}
    {...props}
  />
));
Item.displayName = ContextMenuPrimitive.Item.displayName;

const CheckboxItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <ContextMenuPrimitive.CheckboxItem ref={ref} className={cn('relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50', className)} checked={checked} {...props}>
    <span className="absolute left-2 inline-flex size-3.5 items-center justify-center"><ContextMenuPrimitive.ItemIndicator><Check className="size-3.5" /></ContextMenuPrimitive.ItemIndicator></span>
    {children}
  </ContextMenuPrimitive.CheckboxItem>
));
CheckboxItem.displayName = ContextMenuPrimitive.CheckboxItem.displayName;

const RadioItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.RadioItem ref={ref} className={cn('relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50', className)} {...props}>
    <span className="absolute left-2 inline-flex size-3.5 items-center justify-center"><ContextMenuPrimitive.ItemIndicator><Circle className="size-2" /></ContextMenuPrimitive.ItemIndicator></span>
    {children}
  </ContextMenuPrimitive.RadioItem>
));
RadioItem.displayName = ContextMenuPrimitive.RadioItem.displayName;

const Label = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <ContextMenuPrimitive.Label ref={ref} className={cn('px-2 py-1.5 text-sm font-semibold', inset && 'pl-8', className)} {...props} />
));
Label.displayName = ContextMenuPrimitive.Label.displayName;

const Separator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-muted', className)} {...props} />
));
Separator.displayName = ContextMenuPrimitive.Separator.displayName;

function Shortcut({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('ml-auto text-xs tracking-widest opacity-60', className)} {...props} />;
}
Shortcut.displayName = 'ContextMenuShortcut';

export {
  Root,
  Trigger,
  Content,
  Item,
  CheckboxItem,
  RadioItem,
  Label,
  Separator,
  Shortcut,
  Group,
  Portal,
  Sub,
  SubContent,
  SubTrigger,
  RadioGroup,
};
