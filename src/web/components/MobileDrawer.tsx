import React from 'react';
import * as Sheet from './ui/sheet/index.js';

import { tr } from '../i18n.js';
type MobileDrawerProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: React.ReactNode;
  closeLabel?: string;
  side?: 'left' | 'right';
};

function MobileDrawer({
  open,
  onClose,
  children,
  title,
  closeLabel = tr('app.closenavigate'),
  side = 'left',
}: MobileDrawerProps) {
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
      <Sheet.Content
        side={side}
        aria-label={typeof title === 'string' ? title : closeLabel}
        closeLabel={closeLabel}
        onClose={requestClose}
      >
        <Sheet.Header>
          {title ? <Sheet.Title>{title}</Sheet.Title> : <Sheet.Title className="sr-only">{closeLabel}</Sheet.Title>}
          <Sheet.Description className="sr-only">{closeLabel}</Sheet.Description>
        </Sheet.Header>
        <div className="mt-3 grid gap-3">
          {children}
        </div>
      </Sheet.Content>
    </Sheet.Root>
  );
}

export { MobileDrawer };
export default MobileDrawer;
