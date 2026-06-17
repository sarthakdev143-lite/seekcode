import React, { useState, useEffect } from 'react';
import { useSession } from '../hooks/useSession';
import { useChat } from '../hooks/useChat';
import StatusIndicator from '../components/StatusIndicator';
import ChatContainer from '../components/ChatContainer';

const ChatPage: React.FC = () => {
  const { sessionId, status, createSession, closeSession } = useSession();
  const { messages, isProcessing, sendMessage } = useChat(sessionId);
  const [input, setInput] = useState('');

  useEffect(() => {
    createSession();
    return () => {
      closeSession();
    };
  }, []);

  const handleSend = () => {
    if (input.trim()) {
      sendMessage(input);
      setInput('');
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>SeekCode</h1>
        <StatusIndicator status={status} />
      </header>
      <main className="app-main">
        <ChatContainer
          messages={messages}
          isProcessing={isProcessing}
          input={input}
          onInputChange={setInput}
          onSend={handleSend}
        />
      </main>
    </div>
  );
};

export default ChatPage;
