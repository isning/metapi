import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { centeredContentMotionClassName, overlayMotionClassName } from '../motion.js';

const DialogOpenContext = React.createContext(false);

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
  <DialogOpenContext.Provider value={open ?? defaultOpen ?? false}>
    <DialogPrimitive.Root open={open} defaultOpen={defaultOpen} {...props}>
      {children}
    </DialogPrimitive.Root>
  </DialogOpenContext.Provider>
);
const Trigger = DialogPrimitive.Trigger;
const Portal = DialogPrimitive.Portal;
const Close = DialogPrimitive.Close;

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
    closeButton?: boolean;
    onClose?: () => void;
  }
>(({ className, children, closeButton = true, onClose, ...props }, ref) => {
  const open = React.useContext(DialogOpenContext);
  const contentClassName = cn(
    'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(92vw,560px)] flex-col overflow-y-auto rounded-lg border border-border bg-background p-4 text-foreground shadow-lg',
    centeredContentMotionClassName,
    className,
  );

  if (shouldRenderInlinePortalFallback()) {
    if (!open) return null;
    const {
      onEscapeKeyDown: _onEscapeKeyDown,
      onPointerDownOutside: _onPointerDownOutside,
      onInteractOutside: _onInteractOutside,
      ...divProps
    } = props;
    return (
      <div ref={ref as React.Ref<HTMLDivElement>} data-slot="dialog-content" role="dialog" className={contentClassName} {...divProps}>
        {children}
        {closeButton ? (
          <button
            type="button"
            data-slot="dialog-close"
            className="absolute right-2.5 top-2.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={onClose}
          >
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <Portal>
      <Overlay />
      <DialogPrimitive.Content
        ref={ref}
        data-slot="dialog-content"
        className={contentClassName}
        {...props}
      >
        {children}
        {closeButton ? (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute right-2.5 top-2.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={onClose}
          >
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </Portal>
  );
});
Content.displayName = DialogPrimitive.Content.displayName;

const Header = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('grid gap-1 pr-8', className)} {...props} />
);
Header.displayName = 'DialogHeader';

const Footer = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('mt-3.5 flex flex-wrap justify-end gap-2 border-t pt-3.5', className)} {...props} />
);
Footer.displayName = 'DialogFooter';

const Title = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  shouldRenderInlinePortalFallback()
    ? <h2 ref={ref as React.Ref<HTMLHeadingElement>} className={cn('text-base font-semibold text-foreground', className)} {...props} />
    : <DialogPrimitive.Title ref={ref} className={cn('text-base font-semibold text-foreground', className)} {...props} />
));
Title.displayName = DialogPrimitive.Title.displayName;

const Description = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  shouldRenderInlinePortalFallback()
    ? <p ref={ref as React.Ref<HTMLParagraphElement>} className={cn('text-xs text-muted-foreground', className)} {...props} />
    : <DialogPrimitive.Description ref={ref} className={cn('text-xs text-muted-foreground', className)} {...props} />
));
Description.displayName = DialogPrimitive.Description.displayName;

export { Root, Trigger, Portal, Close, Overlay, Content, Header, Footer, Title, Description };
