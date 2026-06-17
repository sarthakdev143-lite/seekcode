const API_BASE = '/api';

export interface SessionResponse {
  sessionId: string;
  status: string;
  ttl: number;
  sessionLogPath?: string;
}

export interface ChatResponse {
  text: string;
  toolCalls?: any[];
}

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

export class SeekCodeClient {
  private sessionId: string | null = null;
  private sessionLogPath: string | null = null;

  async createSession(workingDir?: string): Promise<SessionResponse> {
    const res = await fetch(`${API_BASE}/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workingDir }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create session');
    }
    const data = await res.json();
    this.sessionId = data.sessionId;
    this.sessionLogPath = data.sessionLogPath || null;
    return data;
  }

  async chat(prompt: string, options?: { tab?: string; model?: string; readOnly?: boolean }): Promise<string> {
    if (!this.sessionId) throw new Error('No active session');
    const res = await fetch(`${API_BASE}/session/${this.sessionId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...options }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Chat request failed');
    }
    const data: ChatResponse = await res.json();
    return data.text;
  }

  async closeSession(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await fetch(`${API_BASE}/session/${this.sessionId}/close`, {
        method: 'POST',
      });
    } finally {
      this.sessionId = null;
      this.sessionLogPath = null;
    }
  }

  async healthCheck(): Promise<HealthResponse> {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error('Health check failed');
    return res.json();
  }

  async listSessions(): Promise<SessionListResponse> {
    const res = await fetch(`${API_BASE}/sessions`);
    if (!res.ok) throw new Error('Failed to list sessions');
    return res.json();
  }

  async getTaskStatus(taskId: string): Promise<TaskStatus | null> {
    const { sessions } = await this.listSessions();
    const found = sessions.find(s => s.id === taskId);
    if (!found) return null;
    return {
      taskId: found.id,
      status: 'ready',
      createdAt: found.metadata?.createdAt,
      lastAccessed: found.metadata?.lastAccessed,
      hasLogs: true,
      logPath: found.metadata?.workingDir,
    };
  }

  async createTask(prompt: string, options?: TaskOptions): Promise<TaskResponse> {
    if (!this.sessionId) {
      await this.createSession(options?.workingDir);
    }
    try {
      const result = await this.chat(prompt, {
        tab: options?.tab,
        model: options?.model,
        readOnly: options?.readOnly,
      });
      return {
        taskId: this.sessionId!,
        status: 'complete',
        result,
        sessionLogPath: this.sessionLogPath || undefined,
      };
    } catch (error) {
      return {
        taskId: this.sessionId!,
        status: 'error',
        sessionLogPath: this.sessionLogPath || undefined,
      };
    }
  }

  async getSessionLogs(): Promise<string | null> {
    if (!this.sessionLogPath) return null;
    try {
      const res = await fetch(this.sessionLogPath);
      if (!res.ok) return null;
      return res.text();
    } catch {
      return null;
    }
  }

  async diagnose(tab?: string): Promise<any> {
    if (!this.sessionId) throw new Error('No active session');
    const res = await fetch(`${API_BASE}/session/${this.sessionId}/diagnose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tab }),
    });
    if (!res.ok) throw new Error('Diagnose failed');
    return res.json();
  }

  async recreateTab(tab?: string): Promise<any> {
    if (!this.sessionId) throw new Error('No active session');
    const res = await fetch(`${API_BASE}/session/${this.sessionId}/tab/recreate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tab }),
    });
    if (!res.ok) throw new Error('Tab recreation failed');
    return res.json();
  }
}

export const seekCodeClient = new SeekCodeClient();
