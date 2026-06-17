export interface Session {
  id: string;
  status: 'ready' | 'error' | 'closed';
  ttl: number;
  sessionLogPath?: string;
  createdAt?: string;
  workingDir?: string;
}

export type SessionStatus = 'idle' | 'creating' | 'ready' | 'error' | 'closed' | 'closing';
