import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { overlayMotionClassName, sheetSideMotionClassName } from '../motion.js';

const SheetOpenContext = React.createContext(false);

function shouldRenderInlinePortalFallback() {
  return typeof document === 'undefined'
    || !document.body
    || typeof document.body.querySelector !== 'function';
}

const Root = ({
  open,
  defaultOpen,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>) => (
  <SheetOpenContext.Provider value={open ?? defaultOpen ?? false}>
    <DialogPrimitive.Root open={open} defaultOpen={defaultOpen} {...props}>
      {children}
    </DialogPrimitive.Root>
  </SheetOpenContext.Provider>
);
const Trigger = DialogPrimitive.Trigger;
const Close = DialogPrimitive.Close;
const Portal = DialogPrimitive.Portal;

const Overlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay ref={ref} className={cn('fixed inset-0 z-50 bg-background/80 backdrop-blur-sm', overlayMotionClassName, className)} {...props} />
));
Overlay.displayName = DialogPrimitive.Overlay.displayName;

const Content = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    side?: 'top' | 'right' | 'bottom' | 'left';
    onClose?: () => void;
    closeLabel?: string;
  }
>(({ side = 'right', className, children, onClose, closeLabel = 'Close', ...props }, ref) => {
  const sideClassName = {
    top: 'inset-x-0 top-0 border-b',
    right: 'inset-y-0 right-0 h-full w-[min(88vw,420px)] border-l',
    bottom: 'inset-x-0 bottom-0 border-t',
    left: 'inset-y-0 left-0 h-full w-[min(88vw,420px)] border-r',
  }[side];

  const contentClassName = cn('fixed z-50 bg-background p-4 text-foreground shadow-lg', sideClassName, sheetSideMotionClassName[side], className);
  const open = React.useContext(SheetOpenContext);

  if (shouldRenderInlinePortalFallback()) {
    if (!open) return null;
    return (
      <div
        ref={ref as React.Ref<HTMLDivElement>}
        data-slot="sheet-content"
        role="dialog"
        className={contentClassName}
        {...props}
      >
        {children}
        <button
          type="button"
          data-slot="sheet-close"
          aria-label={closeLabel}
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={onClose}
        >
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </button>
      </div>
    );
  }

  return (
    <Portal>
      <Overlay />
      <DialogPrimitive.Content
        ref={ref}
        data-slot="sheet-content"
        className={contentClassName}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          data-slot="sheet-close"
          aria-label={closeLabel}
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={onClose}
        >
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </Portal>
  );
});
Content.displayName = DialogPrimitive.Content.displayName;

const Header = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('grid gap-1 pr-8', className)} {...props} />
);
Header.displayName = 'SheetHeader';

const Footer = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
);
Footer.displayName = 'SheetFooter';

const Title = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  shouldRenderInlinePortalFallback()
    ? <h2 ref={ref as React.Ref<HTMLHeadingElement>} className={cn('text-base font-semibold', className)} {...props} />
    : <DialogPrimitive.Title ref={ref} className={cn('text-base font-semibold', className)} {...props} />
));
Title.displayName = DialogPrimitive.Title.displayName;

const Description = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  shouldRenderInlinePortalFallback()
    ? <p ref={ref as React.Ref<HTMLParagraphElement>} className={cn('text-sm text-muted-foreground', className)} {...props} />
    : <DialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
));
Description.displayName = DialogPrimitive.Description.displayName;

export { Root, Trigger, Close, Portal, Overlay, Content, Header, Footer, Title, Description };
