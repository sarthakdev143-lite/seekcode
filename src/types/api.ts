export interface HealthResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  version: string;
  sessions: {
    activeSessions: number;
    maxSessions: number;
    sessionTTL: number;
  };
  timestamp: string;
}

export interface TaskOptions {
  tab?: string;
  model?: string;
  readOnly?: boolean;
  workingDir?: string;
}

export interface TaskResponse {
  taskId: string;
  status: 'created' | 'running' | 'complete' | 'error';
  result?: string;
  sessionLogPath?: string;
}

export interface TaskStatus {
  taskId: string;
  status: 'ready' | 'running' | 'complete' | 'error' | 'closed';
  createdAt?: string;
  lastAccessed?: string;
  hasLogs: boolean;
  logPath?: string;
}

export interface SessionInfo {
  id: string;
  metadata: {
    createdAt?: string;
    workingDir?: string;
    lastAccessed?: string;
  };
}

export interface SessionListResponse {
  stats: {
    activeSessions: number;
    maxSessions: number;
    sessionTTL: number;
  };
  sessions: SessionInfo[];
}
