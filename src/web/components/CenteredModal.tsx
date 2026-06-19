import React from 'react';
import * as Dialog from './ui/dialog/index.js';

type CenteredModalProps = {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: number;
  bodyStyle?: React.CSSProperties;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
};

export default function CenteredModal({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidth = 860,
  bodyStyle,
  closeOnBackdrop = false,
  closeOnEscape = false,
  showCloseButton = true,
}: CenteredModalProps) {
  const maxWidthClass = maxWidth <= 560 ? 'w-[min(92vw,560px)]' : 'w-[min(94vw,860px)]';

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && (closeOnBackdrop || closeOnEscape)) onClose();
      }}
    >
      <Dialog.Content
        className={maxWidthClass}
        closeButton={showCloseButton}
        onClose={onClose}
        onEscapeKeyDown={(event) => {
          if (!closeOnEscape) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (!closeOnBackdrop) event.preventDefault();
        }}
      >
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description className="sr-only">Modal dialog</Dialog.Description>
        </Dialog.Header>
        <div className={bodyStyle ? undefined : 'grid gap-3'} style={bodyStyle}>
          {children}
        </div>
        {footer ? <Dialog.Footer>{footer}</Dialog.Footer> : null}
      </Dialog.Content>
    </Dialog.Root>
  );
}
