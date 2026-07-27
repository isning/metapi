import { useCallback, useEffect, useRef } from 'react';

type UsePrefetchIntentOptions<T> = {
  delayMs: number;
  onIntent: (value: T) => void;
};

export type PrefetchIntent<T> = {
  schedule: (value: T) => void;
  cancel: () => void;
};

export function usePrefetchIntent<T>({
  delayMs,
  onIntent,
}: UsePrefetchIntentOptions<T>): PrefetchIntent<T> {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedule = useCallback((value: T) => {
    cancel();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onIntent(value);
    }, delayMs);
  }, [cancel, delayMs, onIntent]);

  useEffect(() => cancel, [cancel]);

  return { schedule, cancel };
}
