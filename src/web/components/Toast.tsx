import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { toast as sonnerToast } from 'sonner';
import { Toaster } from './ui/sonner/index.js';

type ToastType = 'success' | 'error' | 'info';

interface ToastContextValue {
  toast: (type: ToastType, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const addToast = useCallback((type: ToastType, message: string) => {
    sonnerToast[type](message);
  }, []);

  const success = useCallback((msg: string) => addToast('success', msg), [addToast]);
  const error = useCallback((msg: string) => addToast('error', msg), [addToast]);
  const info = useCallback((msg: string) => addToast('info', msg), [addToast]);

  const value = useMemo<ToastContextValue>(() => ({
    toast: addToast,
    success,
    error,
    info,
  }), [addToast, error, info, success]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster />
    </ToastContext.Provider>
  );
}
