import { useState, useEffect, useRef, useCallback } from 'react';

interface PollingOptions<T> {
  fetchFn: () => Promise<T>;
  onUpdate: (data: T) => void;
  initialInterval?: number;
  maxInterval?: number;
  backoffFactor?: number;
  shouldStop?: (data: T) => boolean;
  onError?: (error: Error) => void;
}

export function usePolling<T>({
  fetchFn,
  onUpdate,
  initialInterval = 1000,
  maxInterval = 30000,
  backoffFactor = 1.5,
  shouldStop,
  onError,
}: PollingOptions<T>) {
  const [isPolling, setIsPolling] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const currentIntervalRef = useRef(initialInterval);
  const lastDataRef = useRef<T | null>(null);
  const consecutiveNoChangeRef = useRef(0);
  const isMountedRef = useRef(true);

  const stopPolling = useCallback(() => {
    setIsPolling(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    if (!isMountedRef.current) return;
    try {
      const data = await fetchFn();
      if (!isMountedRef.current) return;

      const dataChanged = JSON.stringify(data) !== JSON.stringify(lastDataRef.current);

      if (dataChanged) {
        lastDataRef.current = data;
        consecutiveNoChangeRef.current = 0;
        currentIntervalRef.current = Math.max(initialInterval, currentIntervalRef.current / backoffFactor);
        onUpdate(data);
      } else {
        consecutiveNoChangeRef.current++;
        currentIntervalRef.current = Math.min(
          maxInterval,
          currentIntervalRef.current * backoffFactor
        );
      }

      if (shouldStop && shouldStop(data)) {
        stopPolling();
        return;
      }

      const jitter = Math.random() * 0.2 * currentIntervalRef.current;
      const nextInterval = currentIntervalRef.current + jitter;
      timeoutRef.current = setTimeout(poll, nextInterval);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      onError?.(error);
      currentIntervalRef.current = Math.min(
        maxInterval,
        currentIntervalRef.current * 1.5
      );
      const jitter = Math.random() * 0.2 * currentIntervalRef.current;
      timeoutRef.current = setTimeout(poll, currentIntervalRef.current + jitter);
    }
  }, [fetchFn, onUpdate, shouldStop, onError, stopPolling, initialInterval, maxInterval, backoffFactor]);

  const startPolling = useCallback(() => {
    setIsPolling(true);
    lastDataRef.current = null;
    consecutiveNoChangeRef.current = 0;
    currentIntervalRef.current = initialInterval;
    poll();
  }, [poll, initialInterval]);

  useEffect(() => {
    isMountedRef.current = true;
    startPolling();
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [startPolling]);

  return {
    isPolling,
    error,
    stopPolling,
    startPolling,
  };
}
