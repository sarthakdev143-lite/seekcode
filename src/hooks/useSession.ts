import { useState, useCallback } from 'react';
import { seekCodeClient } from '../api/client';

export type SessionStatus = 'idle' | 'creating' | 'ready' | 'error' | 'closed';

export function useSession() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const createSession = useCallback(async (workingDir?: string) => {
    setStatus('creating');
    setError(null);
    try {
      const data = await seekCodeClient.createSession(workingDir);
      setSessionId(data.sessionId);
      setStatus('ready');
    } catch (err: any) {
      setError(err.message || 'Failed to create session');
      setStatus('error');
    }
  }, []);

  const closeSession = useCallback(async () => {
    if (status === 'closed') return;
    setStatus('closing');
    try {
      await seekCodeClient.closeSession();
      setSessionId(null);
      setStatus('closed');
    } catch (err: any) {
      setError(err.message || 'Failed to close session');
      setStatus('error');
    }
  }, [status]);

  return {
    sessionId,
    status,
    error,
    createSession,
    closeSession,
  };
}
