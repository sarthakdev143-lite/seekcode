import { useState, useCallback } from 'react';
import { seekCodeClient } from '../api/client';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export function useChat(sessionId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(async (prompt: string) => {
    if (!sessionId) {
      setError('No active session');
      return;
    }
    if (isProcessing) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);

    setIsProcessing(true);
    setError(null);

    try {
      const reply = await seekCodeClient.chat(prompt);
      const assistantMsg: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: reply,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      setError(err.message || 'Chat failed');
    } finally {
      setIsProcessing(false);
    }
  }, [sessionId, isProcessing]);

  return {
    messages,
    isProcessing,
    error,
    sendMessage,
  };
}
