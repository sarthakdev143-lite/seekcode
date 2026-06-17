import React, { useRef, useEffect } from 'react';
import Message from './Message';
import { Message as MessageType } from '../hooks/useChat';

interface Props {
  messages: MessageType[];
  isProcessing: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
}

const ChatContainer: React.FC<Props> = ({
  messages,
  isProcessing,
  input,
  onInputChange,
  onSend,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="chat-container">
      <div className="messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <p>Start a conversation with SeekCode.</p>
          </div>
        )}
        {messages.map((msg) => (
          <Message key={msg.id} message={msg} />
        ))}
        {isProcessing && (
          <div className="message assistant">
            <div className="message-role">Assistant</div>
            <div className="typing-indicator">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="input-area">
        <textarea
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message..."
          disabled={isProcessing}
          rows={1}
        />
        <button onClick={onSend} disabled={isProcessing || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
};

export default ChatContainer;
