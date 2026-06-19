import React, { useState } from 'react';
import { api } from '../api.js';
import { useToast } from './Toast.js';
import { persistAuthSession } from '../authSession.js';
import { Alert, AlertDescription } from './ui/alert/index.js';
import { Button } from './ui/button/index.js';
import * as Dialog from './ui/dialog/index.js';
import { Input } from './ui/input/index.js';
import { Label } from './ui/label/index.js';

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
      setError('请填写所有字段');
      return;
    }
    if (newToken !== confirmToken) {
      setError('两次输入的新 Token 不一致');
      return;
    }
    if (newToken.length < 6) {
      setError('新 Token 至少 6 个字符');
      return;
    }

    setSaving(true);
    try {
      const res = await api.changeAuthToken(oldToken, newToken);
      if (res.success) {
        toast.success('Token 已更新，请使用新 Token 重新登录');
        persistAuthSession(localStorage, newToken);
        onClose();
        setOldToken('');
        setNewToken('');
        setConfirmToken('');
      } else {
        setError(res.message || '更新失败');
      }
    } catch (e: any) {
      setError(e.message || '更新失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Content className="w-[min(92vw,420px)]">
        <Dialog.Header>
          <Dialog.Title>修改管理员 Token</Dialog.Title>
          <Dialog.Description>更新后当前会话会保存新 Token。</Dialog.Description>
        </Dialog.Header>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="old-admin-token">旧 Token</Label>
            <Input
              id="old-admin-token"
              type="password"
              value={oldToken}
              onChange={e => { setOldToken(e.target.value); setError(''); }}
              placeholder="输入当前 Token"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-admin-token">新 Token</Label>
            <Input
              id="new-admin-token"
              type="password"
              value={newToken}
              onChange={e => { setNewToken(e.target.value); setError(''); }}
              placeholder="输入新 Token (至少 6 位)"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="confirm-admin-token">确认新 Token</Label>
            <Input
              id="confirm-admin-token"
              type="password"
              value={confirmToken}
              onChange={e => { setConfirmToken(e.target.value); setError(''); }}
              placeholder="再次输入新 Token"
            />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <Dialog.Footer>
          <Button type="button" variant="outline" onClick={onClose}>取消</Button>
          <Button type="button" onClick={handleSubmit} disabled={saving}>
            {saving ? '更新中...' : '确认修改'}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
