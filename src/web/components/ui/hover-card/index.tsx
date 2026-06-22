import * as React from 'react';
import * as HoverCardPrimitive from '@radix-ui/react-hover-card';
import { cn } from '../../../lib/utils.js';
import { popoverMotionClassName } from '../motion.js';

const Root = HoverCardPrimitive.Root;
const Trigger = HoverCardPrimitive.Trigger;

const Content = React.forwardRef<
  React.ElementRef<typeof HoverCardPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>
>(({ className, align = 'start', sideOffset = 6, ...props }, ref) => (
  <HoverCardPrimitive.Portal>
    <HoverCardPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn('z-50 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none', popoverMotionClassName, className)}
      {...props}
    />
  </HoverCardPrimitive.Portal>
));
Content.displayName = HoverCardPrimitive.Content.displayName;

export { Root, Trigger, Content };
