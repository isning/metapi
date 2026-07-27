import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { Button } from '../../components/ui/button/index.js';
import * as Dialog from '../../components/ui/dialog/index.js';
import { tr } from '../../i18n.js';

export function useRouteGraphDirtyNavigation(dirty: boolean) {
  const blocker = useBlocker(dirty);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  return blocker;
}

export function RouteGraphDirtyNavigationDialog({
  open,
  saving,
  onStay,
  onDiscard,
  onSave,
}: {
  open: boolean;
  saving: boolean;
  onStay: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen: boolean) => { if (!nextOpen) onStay(); }}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>{tr('pages.tokenRoutes.routeGraphWorkspace.dirtyTitle')}</Dialog.Title>
          <Dialog.Description>{tr('pages.tokenRoutes.routeGraphWorkspace.dirtyDescription')}</Dialog.Description>
        </Dialog.Header>
        <Dialog.Footer>
          <Button type="button" variant="ghost" onClick={onStay}>
            {tr('pages.tokenRoutes.routeGraphWorkspace.stay')}
          </Button>
          <Button type="button" variant="outline" onClick={onDiscard}>
            {tr('pages.tokenRoutes.routeGraphWorkspace.discard')}
          </Button>
          <Button type="button" onClick={onSave} disabled={saving}>
            {tr('pages.tokenRoutes.routeGraphWorkspace.saveAndContinue')}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
