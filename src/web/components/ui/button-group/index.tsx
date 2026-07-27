import * as React from 'react';
import { cn } from '../../../lib/utils.js';

const ButtonGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'inline-flex items-center [&>button]:rounded-none [&>button]:-ml-px [&>button:first-child]:ml-0 [&>button:first-child]:rounded-l-md [&>button:last-child]:rounded-r-md',
      className,
    )}
    role="group"
    {...props}
  />
));
ButtonGroup.displayName = 'ButtonGroup';

export { ButtonGroup };
