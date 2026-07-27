import React from 'react';
import * as Sheet from './ui/sheet/index.js';

import { tr } from '../i18n.js';
type MobileFilterSheetProps = {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
};

export default function MobileFilterSheet({
  open,
  onClose,
  title = tr('components.mobileFilterSheet.filter'),
  children,
}: MobileFilterSheetProps) {
  const closeNotifiedRef = React.useRef(false);
  React.useEffect(() => {
    if (open) closeNotifiedRef.current = false;
  }, [open]);
  const requestClose = React.useCallback(() => {
    if (closeNotifiedRef.current) return;
    closeNotifiedRef.current = true;
    onClose();
  }, [onClose]);

  return (
    <Sheet.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) requestClose(); }}>
      <Sheet.Content side="left" className="w-[min(88vw,360px)]" onClose={requestClose}>
        <Sheet.Header>
          <Sheet.Title>{title}</Sheet.Title>
          <Sheet.Description className="sr-only">{tr('components.mobileFilterSheet.filteritems')}</Sheet.Description>
        </Sheet.Header>
        <div className="mt-3 grid gap-3">
        {children}
        </div>
      </Sheet.Content>
    </Sheet.Root>
  );
}
