import * as React from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { cn } from '../../../lib/utils.js';
import { buttonVariants } from '../button/index.js';
import { centeredContentMotionClassName, overlayMotionClassName } from '../motion.js';

const AlertDialogOpenContext = React.createContext(false);

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
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Root>) => (
  <AlertDialogOpenContext.Provider value={open ?? defaultOpen ?? false}>
    <AlertDialogPrimitive.Root open={open} defaultOpen={defaultOpen} {...props}>
      {children}
    </AlertDialogPrimitive.Root>
  </AlertDialogOpenContext.Provider>
);
const Trigger = AlertDialogPrimitive.Trigger;
const Portal = AlertDialogPrimitive.Portal;
const Cancel = AlertDialogPrimitive.Cancel;
const Action = AlertDialogPrimitive.Action;

const Overlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-background/80 backdrop-blur-sm', overlayMotionClassName, className)}
    {...props}
  />
));
Overlay.displayName = AlertDialogPrimitive.Overlay.displayName;

const Content = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, ...props }, ref) => {
  const open = React.useContext(AlertDialogOpenContext);
  const contentClassName = cn(
    'fixed left-1/2 top-1/2 z-50 grid w-[min(92vw,560px)] gap-3 rounded-lg border border-border bg-background p-4 text-foreground shadow-lg',
    centeredContentMotionClassName,
    className,
  );

  if (shouldRenderInlinePortalFallback()) {
    if (!open) return null;
    return (
      <div
        ref={ref as React.Ref<HTMLDivElement>}
        role="alertdialog"
        className={contentClassName}
        {...props}
      />
    );
  }

  return (
    <Portal>
      <Overlay />
      <AlertDialogPrimitive.Content
        ref={ref}
        className={contentClassName}
        {...props}
      />
    </Portal>
  );
});
Content.displayName = AlertDialogPrimitive.Content.displayName;

const Header = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('grid gap-1', className)} {...props} />
);
Header.displayName = 'AlertDialogHeader';

const Footer = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
);
Footer.displayName = 'AlertDialogFooter';

const Title = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  shouldRenderInlinePortalFallback()
    ? <h2 ref={ref as React.Ref<HTMLHeadingElement>} className={cn('text-base font-semibold', className)} {...props} />
    : <AlertDialogPrimitive.Title ref={ref} className={cn('text-base font-semibold', className)} {...props} />
));
Title.displayName = AlertDialogPrimitive.Title.displayName;

const Description = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  shouldRenderInlinePortalFallback()
    ? <p ref={ref as React.Ref<HTMLParagraphElement>} className={cn('text-sm text-muted-foreground', className)} {...props} />
    : <AlertDialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
));
Description.displayName = AlertDialogPrimitive.Description.displayName;

const CancelButton = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  shouldRenderInlinePortalFallback()
    ? <button ref={ref as React.Ref<HTMLButtonElement>} type="button" className={cn(buttonVariants({ variant: 'outline' }), className)} {...props} />
    : <AlertDialogPrimitive.Cancel ref={ref} className={cn(buttonVariants({ variant: 'outline' }), className)} {...props} />
));
CancelButton.displayName = AlertDialogPrimitive.Cancel.displayName;

const ActionButton = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action> & { variant?: 'default' | 'destructive' }
>(({ className, variant = 'default', ...props }, ref) => (
  shouldRenderInlinePortalFallback()
    ? <button ref={ref as React.Ref<HTMLButtonElement>} type="button" className={cn(buttonVariants({ variant }), className)} {...props} />
    : <AlertDialogPrimitive.Action ref={ref} className={cn(buttonVariants({ variant }), className)} {...props} />
));
ActionButton.displayName = AlertDialogPrimitive.Action.displayName;

export {
  Root,
  Trigger,
  Portal,
  Overlay,
  Content,
  Header,
  Footer,
  Title,
  Description,
  Cancel,
  Action,
  CancelButton,
  ActionButton,
};
