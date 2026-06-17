export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  name: string;
  args: Record<string, any>;
  result?: string;
  isError?: boolean;
}

export interface ChatRequest {
  prompt: string;
  tab?: string;
  model?: string;
  readOnly?: boolean;
}

export interface ChatResponse {
  text: string;
  toolCalls?: ToolCall[];
}
