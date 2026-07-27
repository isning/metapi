import React from 'react';
import CenteredModal from '../../components/CenteredModal.js';
import { Alert, AlertDescription } from '../../components/ui/alert/index.js';
import { Button } from '../../components/ui/button/index.js';
import { Textarea } from '../../components/ui/textarea/index.js';

import { tr } from '../../i18n.js';
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
      title={tr('pages.settings.modelAvailabilityProbeConfirmModal.confirmBatchHealthCheck')}
      maxWidth={760}
      closeOnBackdrop
      footer={(
        <>
          <Button type="button" variant="outline" onClick={handleRequestClose} disabled={saving}>{tr('app.cancel')}</Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={saving || !canConfirm}>
            {saving ? tr('pages.settings.modelAvailabilityProbeConfirmModal.enabling') : tr('pages.settings.modelAvailabilityProbeConfirmModal.confirmBatchHealthCheck')}
          </Button>
        </>
      )}
    >
      <Alert variant="destructive">
        <AlertDescription>
          {tr('pages.settings.modelAvailabilityProbeConfirmModal.probeRiskDescription')}
        </AlertDescription>
      </Alert>
      <div className="text-sm text-muted-foreground">{tr('pages.settings.modelAvailabilityProbeConfirmModal.confirmationInputHint')}</div>
      <div className="rounded-md border bg-background p-3 text-sm text-foreground">
        {confirmText}
      </div>
      <Textarea
        value={confirmationInput}
        onChange={(e) => onConfirmationInputChange(e.target.value)}
        placeholder={tr('pages.settings.modelAvailabilityProbeConfirmModal.enterConfirmationPhraseAbove')}
        spellCheck={false}
      />
    </CenteredModal>
  );
}
