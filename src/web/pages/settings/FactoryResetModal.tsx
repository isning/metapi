import React from 'react';
import CenteredModal from '../../components/CenteredModal.js';
import { Alert, AlertDescription } from '../../components/ui/alert/index.js';
import { Button } from '../../components/ui/button/index.js';

import { tr } from '../../i18n.js';
type ModalPresence = {
  shouldRender: boolean;
  isVisible: boolean;
};

type FactoryResetModalProps = {
  presence: ModalPresence;
  factoryResetting: boolean;
  factoryResetSecondsLeft: number;
  adminToken: string;
  onClose: () => void;
  onConfirm: () => void;
};

export default function FactoryResetModal({
  presence,
  factoryResetting,
  factoryResetSecondsLeft,
  adminToken,
  onClose,
  onConfirm,
}: FactoryResetModalProps) {
  if (!presence.shouldRender) return null;

  const confirmLabel = factoryResetting
    ? tr('pages.settings.factoryResetModal.zh')
    : (factoryResetSecondsLeft > 0
      ? `确认重新初始化系统（${factoryResetSecondsLeft}s）`
      : tr('pages.settings.factoryResetModal.system'));

  return (
    <CenteredModal
      open={presence.shouldRender}
      onClose={onClose}
      title={tr('pages.settings.factoryResetModal.system')}
      maxWidth={720}
      closeOnBackdrop
      footer={(
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={factoryResetting}>{tr('app.cancel')}</Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={factoryResetting || factoryResetSecondsLeft > 0}>
            {confirmLabel}
          </Button>
        </>
      )}
    >
      <Alert variant="destructive">
        <AlertDescription>
          {tr('pages.settings.factoryResetModal.actionsSystemClearMetapiUsagezhAllContent')}
        </AlertDescription>
      </Alert>
      <div className="grid gap-1 text-sm text-muted-foreground">
        <div>{tr('pages.settings.factoryResetModal.usageMysqlPostgresClearZhMetapi')}</div>
        <div>{tr('pages.settings.factoryResetModal.systemDefaultSqlite')}</div>
        <div>{tr('pages.settings.factoryResetModal.adminTokenReset')} <code className="font-mono">{adminToken}</code>。</div>
        <div>{tr('pages.settings.factoryResetModal.signOutRefreshStatus')}</div>
      </div>
    </CenteredModal>
  );
}
