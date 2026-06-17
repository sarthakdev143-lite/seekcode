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

export class SeekCodeClient {
  private sessionId: string | null = null;

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
    }
  }

  async health(): Promise<any> {
    const res = await fetch(`${API_BASE}/health`);
    return res.json();
  }

  async listSessions(): Promise<any> {
    const res = await fetch(`${API_BASE}/sessions`);
    return res.json();
  }
}

export const seekCodeClient = new SeekCodeClient();
