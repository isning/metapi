import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '../../../lib/utils.js';
import { popoverMotionClassName } from '../motion.js';

const Root = PopoverPrimitive.Root;
const Trigger = PopoverPrimitive.Trigger;
const Anchor = PopoverPrimitive.Anchor;

const Content = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn('z-50 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none', popoverMotionClassName, className)}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
Content.displayName = PopoverPrimitive.Content.displayName;

export { Root, Trigger, Anchor, Content };
