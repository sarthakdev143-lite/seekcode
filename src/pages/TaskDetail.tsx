import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { seekCodeClient } from '../api/client';
import { useAppStore } from '../store';
import { usePolling } from '../hooks/usePolling';

const TaskDetailPage: React.FC = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const { updateTask, addNotification } = useAppStore();
  const [taskData, setTaskData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const fetchTaskDetail = async () => {
    if (!taskId) throw new Error('Task ID missing');
    const sessions = await seekCodeClient.listSessions();
    const session = sessions.sessions.find(s => s.id === taskId);
    if (!session) {
      throw new Error('Task not found');
    }
    const detail: any = {
      id: session.id,
      status: 'in-progress',
      createdAt: session.metadata?.createdAt,
      lastAccessed: session.metadata?.lastAccessed,
      steps: [
        { name: 'Session created', status: 'completed', timestamp: session.metadata?.createdAt },
        { name: 'Task execution', status: 'in-progress' },
      ],
      logs: [],
    };
    return detail;
  };

  const { isPolling, stopPolling } = usePolling({
    fetchFn: fetchTaskDetail,
    onUpdate: (data) => {
      setTaskData(data);
      setIsLoading(false);
      setError(null);
      updateTask(data.id, {
        status: data.status,
        lastAccessed: new Date().toISOString(),
      });
    },
    initialInterval: 1000,
    maxInterval: 15000,
    backoffFactor: 1.5,
    shouldStop: (data) => {
      const status = data.status;
      return ['completed', 'failed', 'closed'].includes(status);
    },
    onError: (err) => {
      setError(err.message || 'Failed to load task');
      addNotification({
        type: 'error',
        message: err.message || 'Failed to load task',
      });
      setIsLoading(false);
    },
  });

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [taskData?.logs]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return '✅';
      case 'in-progress': return '🔄';
      case 'failed': return '❌';
      case 'pending': return '⏳';
      case 'closed': return '🔒';
      default: return '❓';
    }
  };

  if (isLoading) {
    return (
      <div className="task-detail-page">
        <div className="loading-state">Loading task details...</div>
      </div>
    );
  }

  if (error || !taskData) {
    return (
      <div className="task-detail-page">
        <div className="error-state">
          <p>{error || 'Task not found'}</p>
          <button onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="task-detail-page">
      <header className="page-header">
        <h1>Task Detail</h1>
        <button className="back-btn" onClick={() => navigate('/dashboard')}>
          ← Back to Dashboard
        </button>
      </header>

      <div className="task-metadata">
        <div className="metadata-grid">
          <div className="metadata-item">
            <span className="label">Task ID</span>
            <span className="value">{taskData.id}</span>
          </div>
          <div className="metadata-item">
            <span className="label">Status</span>
            <span className={`status-badge ${taskData.status}`}>
              {getStatusIcon(taskData.status)} {taskData.status}
            </span>
          </div>
          {taskData.createdAt && (
            <div className="metadata-item">
              <span className="label">Created</span>
              <span className="value">{new Date(taskData.createdAt).toLocaleString()}</span>
            </div>
          )}
          {taskData.lastAccessed && (
            <div className="metadata-item">
              <span className="label">Last Activity</span>
              <span className="value">{new Date(taskData.lastAccessed).toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>

      <div className="task-content">
        <section className="steps-section">
          <h2>Execution Steps</h2>
          <ul className="steps-list">
            {taskData.steps && taskData.steps.length > 0 ? (
              taskData.steps.map((step: any, idx: number) => (
                <li key={idx} className={`step-item ${step.status}`}>
                  <span className="step-icon">{getStatusIcon(step.status)}</span>
                  <span className="step-name">{step.name}</span>
                  {step.timestamp && (
                    <span className="step-time">{new Date(step.timestamp).toLocaleTimeString()}</span>
                  )}
                </li>
              ))
            ) : (
              <li className="step-item pending">
                <span className="step-icon">⏳</span>
                <span className="step-name">Waiting for execution...</span>
              </li>
            )}
          </ul>
        </section>

        <section className="logs-section">
          <h2>Live Logs</h2>
          <div className="logs-container">
            {taskData.logs && taskData.logs.length > 0 ? (
              taskData.logs.map((log: any, idx: number) => (
                <div key={idx} className={`log-entry ${log.level}`}>
                  <span className="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  <span className="log-level">[{log.level}]</span>
                  <span className="log-message">{log.message}</span>
                </div>
              ))
            ) : (
              <div className="log-entry info">
                <span className="log-message">No logs available yet.</span>
              </div>
            )}
            <div ref={logsEndRef} />
          </div>
        </section>
      </div>
    </div>
  );
};

export default TaskDetailPage;
