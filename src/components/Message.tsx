import React from 'react';
import { Message as MessageType } from '../hooks/useChat';

interface Props {
  message: MessageType;
}

const Message: React.FC<Props> = ({ message }) => {
  const isUser = message.role === 'user';
  return (
    <div className={`message ${isUser ? 'user' : 'assistant'}`}>
      <div className="message-role">{isUser ? 'You' : 'Assistant'}</div>
      <div className="message-content">{message.content}</div>
    </div>
  );
};

export default Message;
