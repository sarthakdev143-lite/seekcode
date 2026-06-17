import React from 'react';
import { SessionStatus } from '../hooks/useSession';

interface Props {
  status: SessionStatus;
}

const StatusIndicator: React.FC<Props> = ({ status }) => {
  const getStatusText = () => {
    switch (status) {
      case 'idle': return '⚪ Idle';
      case 'creating': return '🔄 Connecting...';
      case 'ready': return '🟢 Ready';
      case 'error': return '🔴 Error';
      case 'closed': return '⚪ Closed';
      default: return '⚪ Unknown';
    }
  };

  return (
    <div className="status-indicator">
      <span>{getStatusText()}</span>
    </div>
  );
};

export default StatusIndicator;
