import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import { seekCodeClient } from '../api/client';
import { useAppStore } from '../store';

interface FormData {
  description: string;
  taskType: 'code_generation' | 'bug_fix' | 'refactor' | 'analysis' | 'general';
  workingDir: string;
  model: string;
  readOnly: boolean;
}

const TASK_TYPES = [
  { value: 'general', label: 'General Task' },
  { value: 'code_generation', label: 'Code Generation' },
  { value: 'bug_fix', label: 'Bug Fix' },
  { value: 'refactor', label: 'Refactor Code' },
  { value: 'analysis', label: 'Code Analysis' },
];

const MODELS = [
  { value: 'default', label: 'Default' },
  { value: 'deepseek-r1', label: 'DeepSeek R1' },
  { value: 'deepseek-v3', label: 'DeepSeek V3' },
];

const NewTaskPage: React.FC = () => {
  const navigate = useNavigate();
  const { status } = useSession();
  const { addTask, addNotification, setLoading, isLoading } = useAppStore();
  const [formData, setFormData] = useState<FormData>({
    description: '',
    taskType: 'general',
    workingDir: '',
    model: 'default',
    readOnly: false,
  });
  const [error, setError] = useState<string | null>(null);

  const handleChange = (field: keyof FormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.description.trim()) {
      setError('Please enter a task description');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const sessionData = await seekCodeClient.createSession(
        formData.workingDir || undefined
      );

      const enhancedPrompt = `[Task Type: ${formData.taskType}]

${formData.description}`;
      
      await seekCodeClient.chat(enhancedPrompt, {
        model: formData.model !== 'default' ? formData.model : undefined,
        readOnly: formData.readOnly,
      });

      addTask({
        id: sessionData.sessionId,
        description: formData.description,
        status: 'in-progress',
        createdAt: new Date().toISOString(),
      });

      addNotification({
        type: 'success',
        message: `Task created successfully!`,
      });

      navigate(`/task/${sessionData.sessionId}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create task');
      addNotification({
        type: 'error',
        message: err.message || 'Failed to create task',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="new-task-page">
      <header className="page-header">
        <h1>Create New Task</h1>
        <button className="back-btn" onClick={() => navigate('/dashboard')}>
          ← Back to Dashboard
        </button>
      </header>

      <form onSubmit={handleSubmit} className="task-form">
        {error && <div className="error-message">{error}</div>}

        <div className="form-group">
          <label htmlFor="description">
            Task Description <span className="required">*</span>
          </label>
          <textarea
            id="description"
            value={formData.description}
            onChange={(e) => handleChange('description', e.target.value)}
            placeholder="Describe what you want SeekCode to do..."
            rows={6}
            required
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="taskType">Task Type</label>
            <select
              id="taskType"
              value={formData.taskType}
              onChange={(e) => handleChange('taskType', e.target.value)}
            >
              {TASK_TYPES.map(type => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="model">Model</label>
            <select
              id="model"
              value={formData.model}
              onChange={(e) => handleChange('model', e.target.value)}
            >
              {MODELS.map(model => (
                <option key={model.value} value={model.value}>
                  {model.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="workingDir">Working Directory</label>
          <input
            id="workingDir"
            type="text"
            value={formData.workingDir}
            onChange={(e) => handleChange('workingDir', e.target.value)}
            placeholder="Leave empty to use default"
          />
        </div>

        <div className="form-group checkbox">
          <label>
            <input
              type="checkbox"
              checked={formData.readOnly}
              onChange={(e) => handleChange('readOnly', e.target.checked)}
            />
            Read-Only Mode (prevent file modifications)
          </label>
        </div>

        <button
          type="submit"
          className="submit-btn"
          disabled={isLoading || status === 'creating'}
        >
          {isLoading ? 'Creating Task...' : 'Create Task →'}
        </button>
      </form>
    </div>
  );
};

export default NewTaskPage;
