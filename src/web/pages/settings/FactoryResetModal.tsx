import React from 'react';
import CenteredModal from '../../components/CenteredModal.js';
import { Alert, AlertDescription } from '../../components/ui/alert/index.js';
import { Button } from '../../components/ui/button/index.js';

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
    ? '重新初始化中...'
    : (factoryResetSecondsLeft > 0
      ? `确认重新初始化系统（${factoryResetSecondsLeft}s）`
      : '确认重新初始化系统');

  return (
    <CenteredModal
      open={presence.shouldRender}
      onClose={onClose}
      title="确认重新初始化系统"
      maxWidth={720}
      closeOnBackdrop
      footer={(
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={factoryResetting}>取消</Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={factoryResetting || factoryResetSecondsLeft > 0}>
            {confirmLabel}
          </Button>
        </>
      )}
    >
      <Alert variant="destructive">
        <AlertDescription>
          这是不可逆操作。系统会清空当前 metapi 使用中的全部数据库内容，并在成功后立即退出当前登录状态。
        </AlertDescription>
      </Alert>
      <div className="grid gap-1 text-sm text-muted-foreground">
        <div>• 当前若使用外部 MySQL/Postgres，也会先清空该外部库中的 metapi 数据。</div>
        <div>• 系统随后会强制切回默认 SQLite。</div>
        <div>• 管理员 Token 将重置为 <code className="font-mono">{adminToken}</code>。</div>
        <div>• 完成后会立即退出登录并刷新页面，回到当前首装初始状态。</div>
      </div>
    </CenteredModal>
  );
}
