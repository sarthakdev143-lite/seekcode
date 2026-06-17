export interface ApiResponse<T = any> {
  data: T;
  error?: string;
  status: number;
}

export interface CreateSessionResponse {
  sessionId: string;
  status: 'ready';
  ttl: number;
  sessionLogPath: string;
}

export interface ChatResponseData {
  text: string;
  toolCalls: ToolCall[];
}
