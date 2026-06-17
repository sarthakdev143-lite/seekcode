import React, { useEffect } from 'react';
import { Notification as NotificationType } from '../store';

interface NotificationProps {
  notification: NotificationType;
  onDismiss: (id: string) => void;
}

const Notification: React.FC<NotificationProps> = ({ notification, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(notification.id), 5000);
    return () => clearTimeout(timer);
  }, [notification.id, onDismiss]);

  const getIcon = () => {
    switch (notification.type) {
      case 'success': return '✅';
      case 'error': return '❌';
      case 'warning': return '⚠️';
      case 'info': return 'ℹ️';
      default: return 'ℹ️';
    }
  };

  const getClassName = () => {
    switch (notification.type) {
      case 'success': return 'notification-success';
      case 'error': return 'notification-error';
      case 'warning': return 'notification-warning';
      case 'info': return 'notification-info';
      default: return 'notification-info';
    }
  };

  return (
    <div className={`notification ${getClassName()}`}>
      <span className="notification-icon">{getIcon()}</span>
      <span className="notification-message">{notification.message}</span>
      <button
        className="notification-dismiss"
        onClick={() => onDismiss(notification.id)}
      >
        ×
      </button>
    </div>
  );
};

export default Notification;
