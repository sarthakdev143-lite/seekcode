// =============================================================================
// code/useStreamingChat.ts  →  seekcode-gui/src/hooks/useStreamingChat.ts
// =============================================================================
// Hook for consuming the gateway's SSE streaming endpoint.
// Handles: token streaming, tool-call events, thinking indicator, errors.
// =============================================================================

import { useState, useCallback, useRef, useEffect } from 'react';
import { useAppStore } from '../store';
import { seekCodeClient } from '../api/client';

interface StreamEvent {
  type: 'session_started' | 'token' | 'tool_call' | 'tool_call_start' |
        'tool_call_result' | 'thinking' | 'done' | 'error';
  [key: string]: any;
}

interface UseStreamingChatResult {
  send: (prompt: string) => Promise<void>;
  stop: () => void;
  isStreaming: boolean;
  error: string | null;
}

export function useStreamingChat(): UseStreamingChatResult {
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sessionId = useAppStore(s => s.sessionId);
  const currentModel = useAppStore(s => (s as any).currentModel || 'R1');
  const createSession = useAppStore(s => s.createSession);
  const addMessage = useAppStore(s => s.addMessage);
  const updateMessage = useAppStore(s => s.updateMessage);

  // Streaming state actions
  const startStreaming = useAppStore(s => (s as any).startStreaming);
  const appendStreamingToken = useAppStore(s => (s as any).appendStreamingToken);
  const appendStreamingToolCall = useAppStore(s => (s as any).appendStreamingToolCall);
  const finishStreaming = useAppStore(s => (s as any).finishStreaming);

  // Ensure a session exists
  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionId) return sessionId;
    const session = await createSession();
    return session.id;
  }, [sessionId, createSession]);

  const send = useCallback(async (prompt: string) => {
    if (!prompt.trim() || isStreaming) return;

    setError(null);
    setIsStreaming(true);

    try {
      const sid = await ensureSession();

      // Add user message to store
      const userMsgId = `msg_${Date.now()}_user`;
      addMessage(sid, {
        id: userMsgId,
        role: 'user',
        content: prompt,
        timestamp: new Date().toISOString(),
      });

      // Start streaming — create assistant message placeholder
      const assistantMsgId = `msg_${Date.now()}_assistant`;
      addMessage(sid, {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        toolCalls: [],
        timestamp: new Date().toISOString(),
      });

      startStreaming?.(assistantMsgId);

      // Set up abort controller
      const controller = new AbortController();
      abortRef.current = controller;

      // Stream via SSE
      await consumeSSEStream(
        sid,
        prompt,
        currentModel,
        controller.signal,
        (event: StreamEvent) => {
          switch (event.type) {
            case 'token':
              appendStreamingToken?.(event.content || '');
              break;

            case 'tool_call_start':
              appendStreamingToolCall?.({
                id: event.toolCallId,
                name: event.name,
                args: event.args,
                result: undefined,
                isError: false,
              });
              break;

            case 'tool_call_result':
              // Update the tool call with its result
              // (need to find it in streamingToolCalls and update)
              const state = useAppStore.getState();
              const streaming = (state as any).streamingToolCalls || [];
              const updated = streaming.map((tc: any) =>
                tc.id === event.toolCallId
                  ? {
                      ...tc,
                      result: event.result,
                      isError: event.isError,
                      durationMs: event.durationMs,
                      truncated: event.truncated,
                    }
                  : tc
              );
              useAppStore.setState({ streamingToolCalls: updated } as any);
              break;

            case 'thinking':
              // Could update UI to show "Thinking… elapsedMs"
              break;

            case 'done':
              // Finalize — move streaming content into the assistant message
              const finalState = useAppStore.getState();
              const finalTokens = (finalState as any).streamingTokens || '';
              const finalToolCalls = (finalState as any).streamingToolCalls || [];

              updateMessage(sid, assistantMsgId, {
                content: finalTokens,
                toolCalls: finalToolCalls,
              });
              finishStreaming?.();
              break;

            case 'error':
              setError(event.message || 'Stream failed');
              updateMessage(sid, assistantMsgId, {
                content: `⚠️ Error: ${event.message}`,
              });
              finishStreaming?.();
              break;
          }
        }
      );
    } catch (err: any) {
      const msg = err.message || 'Failed to send message';
      setError(msg);
      finishStreaming?.();
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [
    isStreaming, ensureSession, addMessage, updateMessage,
    startStreaming, appendStreamingToken, appendStreamingToolCall, finishStreaming,
    currentModel,
  ]);

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsStreaming(false);
    finishStreaming?.();
  }, [finishStreaming]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  return { send, stop, isStreaming, error };
}

// ─────────────────────────────────────────────────────────────────────────────
//  SSE consumer — reads from /api/session/:id/chat/stream
// ─────────────────────────────────────────────────────────────────────────────

async function consumeSSEStream(
  sessionId: string,
  prompt: string,
  model: string,
  signal: AbortSignal,
  onEvent: (event: StreamEvent) => void
): Promise<void> {
  const API_BASE = '/api';
  const url = `${API_BASE}/session/${sessionId}/chat/stream`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model }),
    signal,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Chat stream failed');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // keep incomplete line in buffer

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr) continue;

      try {
        const event = JSON.parse(jsonStr);
        onEvent(event);
      } catch (e) {
        // Ignore parse errors — partial lines or comments
      }
    }
  }

  // Process any remaining data in buffer
  if (buffer.startsWith('data:')) {
    try {
      const event = JSON.parse(buffer.slice(5).trim());
      onEvent(event);
    } catch {}
  }
}
