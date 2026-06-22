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
        className={`${maxWidthClass} max-h-[calc(100dvh-2rem)] overflow-hidden`}
        closeButton={showCloseButton}
        onClose={onClose}
        onEscapeKeyDown={(event) => {
          if (!closeOnEscape) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (!closeOnBackdrop) event.preventDefault();
        }}
      >
        <Dialog.Header className="shrink-0">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description className="sr-only">Modal dialog</Dialog.Description>
        </Dialog.Header>
        <div
          className={bodyStyle ? 'min-h-0 overflow-y-auto pb-3' : 'grid min-h-0 gap-3 overflow-y-auto pb-3'}
          style={bodyStyle}
        >
          {children}
        </div>
        {footer ? <Dialog.Footer className="shrink-0">{footer}</Dialog.Footer> : null}
      </Dialog.Content>
    </Dialog.Root>
  );
}
