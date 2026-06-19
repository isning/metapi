import React from 'react';
import CenteredModal from '../../components/CenteredModal.js';
import { Alert, AlertDescription } from '../../components/ui/alert/index.js';
import { Button } from '../../components/ui/button/index.js';
import { Textarea } from '../../components/ui/textarea/index.js';

type ModalPresence = {
  shouldRender: boolean;
  isVisible: boolean;
};

type ModelAvailabilityProbeConfirmModalProps = {
  presence: ModalPresence;
  confirmText: string;
  confirmationInput: string;
  saving: boolean;
  onConfirmationInputChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
};

export default function ModelAvailabilityProbeConfirmModal({
  presence,
  confirmText,
  confirmationInput,
  saving,
  onConfirmationInputChange,
  onClose,
  onConfirm,
}: ModelAvailabilityProbeConfirmModalProps) {
  if (!presence.shouldRender) return null;

  const canConfirm = confirmationInput.trim() === confirmText;
  const handleRequestClose = () => {
    if (saving) return;
    onClose();
  };

  return (
    <CenteredModal
      open={presence.shouldRender}
      onClose={handleRequestClose}
      title="确认开启批量测活"
      maxWidth={760}
      closeOnBackdrop
      footer={(
        <>
          <Button type="button" variant="outline" onClick={handleRequestClose} disabled={saving}>取消</Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={saving || !canConfirm}>
            {saving ? '确认开启中...' : '确认开启批量测活'}
          </Button>
        </>
      )}
    >
      <Alert variant="destructive">
        <AlertDescription>
          开启后，metapi 会在后台对活跃账号模型做最小化探测请求。这可能被部分中转站视为批量测活或异常行为，请务必先确认你的中转站明确允许此类探测。
        </AlertDescription>
      </Alert>
      <div className="text-sm text-muted-foreground">请手动输入以下整句后再开启：</div>
      <div className="rounded-md border bg-background p-3 text-sm text-foreground">
        {confirmText}
      </div>
      <Textarea
        value={confirmationInput}
        onChange={(e) => onConfirmationInputChange(e.target.value)}
        placeholder="请输入上方确认语句"
        spellCheck={false}
      />
    </CenteredModal>
  );
}
