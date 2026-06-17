import { usePolling } from './usePolling';
import { useAppStore } from '../store';

interface PollingWithStoreOptions<T> {
  fetchFn: () => Promise<T>;
  onUpdate?: (data: T) => void;
  selector?: (state: any) => any;
  initialInterval?: number;
  maxInterval?: number;
  backoffFactor?: number;
  shouldStop?: (data: T) => boolean;
  onError?: (error: Error) => void;
}

export function usePollingWithStore<T>({
  fetchFn,
  onUpdate,
  selector,
  ...pollingOptions
}: PollingWithStoreOptions<T>) {
  const setTasks = useAppStore((state) => state.setTasks);
  const addTask = useAppStore((state) => state.addTask);
  const updateTask = useAppStore((state) => state.updateTask);
  const addNotification = useAppStore((state) => state.addNotification);

  const defaultOnUpdate = (data: any) => {
    if (data && data.sessions) {
      const tasks = data.sessions.map((s: any) => ({
        id: s.id,
        status: 'pending',
        createdAt: s.metadata?.createdAt,
        lastAccessed: s.metadata?.lastAccessed,
        description: s.metadata?.description || 'Task',
      }));
      setTasks(tasks);
    }
  };

  const handleUpdate = onUpdate || defaultOnUpdate;

  const { isPolling, error, stopPolling, startPolling } = usePolling({
    fetchFn,
    onUpdate: handleUpdate,
    ...pollingOptions,
  });

  return {
    isPolling,
    error,
    stopPolling,
    startPolling,
  };
}
