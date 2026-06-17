import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import { seekCodeClient } from '../api/client';
import { useAppStore } from '../store';
import { usePolling } from '../hooks/usePolling';
import StatusIndicator from '../components/StatusIndicator';

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { status } = useSession();
  const { tasks, setTasks, addNotification } = useAppStore();
  const [healthStatus, setHealthStatus] = useState<'online' | 'offline' | 'checking'>('checking');

  const checkHealth = async () => {
    try {
      await seekCodeClient.healthCheck();
      setHealthStatus('online');
    } catch {
      setHealthStatus('offline');
    }
  };

  const fetchTasks = async () => {
    const sessions = await seekCodeClient.listSessions();
    const taskList = sessions.sessions.map((s: any) => ({
      id: s.id,
      status: 'pending' as const,
      createdAt: s.metadata?.createdAt,
      lastAccessed: s.metadata?.lastAccessed,
      description: s.metadata?.description || 'Task',
    }));
    return taskList;
  };

  // Poll for tasks with intelligent backoff
  usePolling({
    fetchFn: fetchTasks,
    onUpdate: (data) => {
      setTasks(data);
    },
    initialInterval: 3000,
    maxInterval: 30000,
    backoffFactor: 1.3,
    onError: (err) => {
      console.error('Failed to fetch tasks:', err);
      addNotification({
        type: 'error',
        message: 'Failed to fetch tasks from gateway',
      });
    },
  });

  // Health check on mount (not polled frequently)
  React.useEffect(() => {
    checkHealth();
  }, []);

  const handleStartTask = () => {
    navigate('/new-task');
  };

  const handleTaskClick = (taskId: string) => {
    navigate(`/task/${taskId}`);
  };

  const getStatusLabel = (status: string) => {
    const map: Record<string, { label: string; className: string }> = {
      pending: { label: '⏳ Pending', className: 'pending' },
      'in-progress': { label: '🔄 Running', className: 'running' },
      completed: { label: '✅ Complete', className: 'complete' },
      failed: { label: '❌ Error', className: 'error' },
      closed: { label: '⚪ Closed', className: 'closed' },
    };
    return map[status] || { label: '❓ Unknown', className: 'unknown' };
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>SeekCode Dashboard</h1>
        <div className="health-status">
          <span className={`health-indicator ${healthStatus}`}>
            {healthStatus === 'online' ? '🟢 Online' :
             healthStatus === 'offline' ? '🔴 Offline' : '🔄 Checking...'}
          </span>
          <StatusIndicator status={status} />
        </div>
      </header>

      <div className="dashboard-grid">
        <div className="quick-actions">
          <button onClick={handleStartTask} className="start-task-btn">
            ➕ Start New Task
          </button>
        </div>

        <div className="tasks-section">
          <h2>Recent Tasks</h2>
          {tasks.length === 0 ? (
            <p className="empty-state">No tasks yet. Start one using the button above.</p>
          ) : (
            <ul className="task-list">
              {tasks.slice(0, 10).map((task) => {
                const { label, className } = getStatusLabel(task.status);
                return (
                  <li key={task.id} className="task-item" onClick={() => handleTaskClick(task.id)}>
                    <div className="task-info">
                      <span className="task-id">{task.id.slice(0, 8)}...</span>
                      <span className={`task-status ${className}`}>{label}</span>
                      {task.description && <span className="task-dir">{task.description}</span>}
                    </div>
                    <div className="task-meta">
                      {task.createdAt && new Date(task.createdAt).toLocaleString()}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
