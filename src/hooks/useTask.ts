import { useState, useCallback } from 'react';
import { seekCodeClient } from '../api/client';
import { TaskOptions, TaskResponse, TaskStatus } from '../types/api';

export function useTask() {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState<TaskResponse['status'] | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createTask = useCallback(async (prompt: string, options?: TaskOptions) => {
    setIsProcessing(true);
    setError(null);
    try {
      const response = await seekCodeClient.createTask(prompt, options);
      setTaskId(response.taskId);
      setStatus(response.status);
      if (response.result) setResult(response.result);
      return response;
    } catch (err: any) {
      setError(err.message || 'Task creation failed');
      throw err;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const getTaskStatus = useCallback(async (id: string): Promise<TaskStatus | null> => {
    try {
      return await seekCodeClient.getTaskStatus(id);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch task status');
      return null;
    }
  }, []);

  const clearTask = useCallback(() => {
    setTaskId(null);
    setStatus(null);
    setResult(null);
    setError(null);
  }, []);

  return {
    taskId,
    status,
    result,
    isProcessing,
    error,
    createTask,
    getTaskStatus,
    clearTask,
  };
}
