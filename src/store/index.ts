import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Task {
  id: string;
  description?: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'closed';
  createdAt?: string;
  lastAccessed?: string;
  steps?: Array<{
    name: string;
    status: 'pending' | 'in-progress' | 'completed' | 'failed';
    timestamp?: string;
  }>;
}

export interface Notification {
  id: string;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
  timestamp: number;
}

interface AppState {
  // Tasks
  tasks: Task[];
  currentTaskId: string | null;
  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  removeTask: (id: string) => void;
  setCurrentTaskId: (id: string | null) => void;
  getTask: (id: string) => Task | undefined;

  // Notifications
  notifications: Notification[];
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;

  // Session
  sessionId: string | null;
  setSessionId: (id: string | null) => void;

  // UI State
  isLoading: boolean;
  setLoading: (loading: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      tasks: [],
      currentTaskId: null,
      setTasks: (tasks) => set({ tasks }),
      addTask: (task) => set((state) => ({
        tasks: [...state.tasks, task],
        currentTaskId: task.id,
      })),
      updateTask: (id, updates) => set((state) => ({
        tasks: state.tasks.map((task) =>
          task.id === id ? { ...task, ...updates } : task
        ),
      })),
      removeTask: (id) => set((state) => ({
        tasks: state.tasks.filter((task) => task.id !== id),
        currentTaskId: state.currentTaskId === id ? null : state.currentTaskId,
      })),
      setCurrentTaskId: (id) => set({ currentTaskId: id }),
      getTask: (id) => get().tasks.find((task) => task.id === id),

      notifications: [],
      addNotification: (notification) => {
        const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        set((state) => ({
          notifications: [
            ...state.notifications,
            { ...notification, id, timestamp: Date.now() },
          ],
        }));
        setTimeout(() => {
          set((state) => ({
            notifications: state.notifications.filter((n) => n.id !== id),
          }));
        }, 5000);
      },
      removeNotification: (id) => set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== id),
      })),
      clearNotifications: () => set({ notifications: [] }),

      sessionId: null,
      setSessionId: (id) => set({ sessionId: id }),

      isLoading: false,
      setLoading: (loading) => set({ isLoading: loading }),
    }),
    {
      name: 'seekcode-store',
      partialize: (state) => ({
        tasks: state.tasks,
        currentTaskId: state.currentTaskId,
        sessionId: state.sessionId,
      }),
    }
  )
);
