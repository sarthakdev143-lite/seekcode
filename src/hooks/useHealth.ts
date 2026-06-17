import { useState, useCallback } from 'react';
import { seekCodeClient } from '../api/client';
import { HealthResponse } from '../types/api';

export function useHealth() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkHealth = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await seekCodeClient.healthCheck();
      setHealth(data);
      return data;
    } catch (err: any) {
      setError(err.message || 'Health check failed');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const listSessions = useCallback(async () => {
    try {
      return await seekCodeClient.listSessions();
    } catch (err: any) {
      setError(err.message || 'Failed to list sessions');
      throw err;
    }
  }, []);

  return {
    health,
    isLoading,
    error,
    checkHealth,
    listSessions,
  };
}
