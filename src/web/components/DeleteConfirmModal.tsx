import React from 'react';
import * as AlertDialog from './ui/alert-dialog/index.js';
import { Alert, AlertDescription, AlertTitle } from './ui/alert/index.js';
import { Button } from './ui/button/index.js';

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
  title = '确认删除',
  description,
  confirmText = '确认删除',
  cancelText = '取消',
  loading = false,
  onConfirm,
  onClose,
}: DeleteConfirmModalProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <AlertDialog.Content>
        <AlertDialog.Header>
          <AlertDialog.Title>{title}</AlertDialog.Title>
          <AlertDialog.Description>请确认该操作是否符合预期。</AlertDialog.Description>
        </AlertDialog.Header>
        <Alert variant="destructive">
          <AlertTitle>此操作不可撤销</AlertTitle>
          <AlertDescription>{description}</AlertDescription>
        </Alert>
        <AlertDialog.Footer>
          <AlertDialog.CancelButton disabled={loading}>{cancelText}</AlertDialog.CancelButton>
          <Button type="button" variant="destructive" disabled={loading} onClick={onConfirm}>
            {loading ? '删除中...' : confirmText}
          </Button>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
