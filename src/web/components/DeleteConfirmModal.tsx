import React from 'react';
import * as AlertDialog from './ui/alert-dialog/index.js';
import { Alert, AlertDescription, AlertTitle } from './ui/alert/index.js';
import { Button } from './ui/button/index.js';

import { tr } from '../i18n.js';
type DeleteConfirmModalProps = {
  open: boolean;
  title?: string;
  description: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export default function DeleteConfirmModal({
  open,
  title = tr('components.deleteConfirmModal.delete'),
  description,
  confirmText = tr('components.deleteConfirmModal.delete'),
  cancelText = tr('app.cancel'),
  loading = false,
  onConfirm,
  onClose,
}: DeleteConfirmModalProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <AlertDialog.Content>
        <AlertDialog.Header>
          <AlertDialog.Title>{title}</AlertDialog.Title>
          <AlertDialog.Description>{tr('components.deleteConfirmModal.actions2')}</AlertDialog.Description>
        </AlertDialog.Header>
        <Alert variant="destructive">
          <AlertTitle>{tr('components.deleteConfirmModal.actions')}</AlertTitle>
          <AlertDescription>{description}</AlertDescription>
        </Alert>
        <AlertDialog.Footer>
          <AlertDialog.CancelButton disabled={loading}>{cancelText}</AlertDialog.CancelButton>
          <Button type="button" variant="destructive" disabled={loading} onClick={onConfirm}>
            {loading ? tr('components.deleteConfirmModal.deleting') : confirmText}
          </Button>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
