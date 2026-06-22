import React, { useState } from 'react';
import { api } from '../api.js';
import { useToast } from './Toast.js';
import { persistAuthSession } from '../authSession.js';
import { Alert, AlertDescription } from './ui/alert/index.js';
import { Button } from './ui/button/index.js';
import * as Dialog from './ui/dialog/index.js';
import { Input } from './ui/input/index.js';
import { Label } from './ui/label/index.js';

import { tr } from '../i18n.js';
export default function ChangeKeyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [oldToken, setOldToken] = useState('');
  const [newToken, setNewToken] = useState('');
  const [confirmToken, setConfirmToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const handleSubmit = async () => {
    setError('');
    if (!oldToken || !newToken || !confirmToken) {
      setError(tr('components.changeKeyModal.pleaseFillAllFields'));
      return;
    }
    if (newToken !== confirmToken) {
      setError(tr('components.changeKeyModal.newTokenEnteredTwiceInconsistent'));
      return;
    }
    if (newToken.length < 6) {
      setError(tr('components.changeKeyModal.newTokenMustLeast6CharactersLong'));
      return;
    }

    setSaving(true);
    try {
      const res = await api.changeAuthToken(oldToken, newToken);
      if (res.success) {
        toast.success(tr('components.changeKeyModal.tokenHasBeenUpdatedPleaseUseNew'));
        persistAuthSession(localStorage, newToken);
        onClose();
        setOldToken('');
        setNewToken('');
        setConfirmToken('');
      } else {
        setError(res.message || tr('components.changeKeyModal.updateFailed'));
      }
    } catch (e: any) {
      setError(e.message || tr('components.changeKeyModal.updateFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Content className="w-[min(92vw,420px)]">
        <Dialog.Header>
          <Dialog.Title>{tr('components.changeKeyModal.adminToken')}</Dialog.Title>
          <Dialog.Description>{tr('components.changeKeyModal.saveToken')}</Dialog.Description>
        </Dialog.Header>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="old-admin-token">{tr('components.changeKeyModal.token')}</Label>
            <Input
              id="old-admin-token"
              type="password"
              value={oldToken}
              onChange={e => { setOldToken(e.target.value); setError(''); }}
              placeholder={tr('components.changeKeyModal.enterCurrentToken')}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-admin-token">{tr('components.changeKeyModal.token3')}</Label>
            <Input
              id="new-admin-token"
              type="password"
              value={newToken}
              onChange={e => { setNewToken(e.target.value); setError(''); }}
              placeholder={tr('components.changeKeyModal.enterNewTokenLeast6Digits')}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="confirm-admin-token">{tr('components.changeKeyModal.token2')}</Label>
            <Input
              id="confirm-admin-token"
              type="password"
              value={confirmToken}
              onChange={e => { setConfirmToken(e.target.value); setError(''); }}
              placeholder={tr('components.changeKeyModal.enterNewTokenAgain')}
            />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <Dialog.Footer>
          <Button type="button" variant="outline" onClick={onClose}>{tr('app.cancel')}</Button>
          <Button type="button" onClick={handleSubmit} disabled={saving}>
            {saving ? tr('components.changeKeyModal.updating') : tr('components.changeKeyModal.confirmChanges')}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
