import { createBrowserRouter } from 'react-router-dom';
import ChatPage from '../pages/ChatPage';
import SessionsPage from '../pages/SessionsPage';
import SettingsPage from '../pages/SettingsPage';
import DashboardPage from '../pages/DashboardPage';
import NewTaskPage from '../pages/NewTask';
import TaskDetailPage from '../pages/TaskDetail';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <DashboardPage />,
  },
  {
    path: '/dashboard',
    element: <DashboardPage />,
  },
  {
    path: '/chat',
    element: <ChatPage />,
  },
  {
    path: '/new-task',
    element: <NewTaskPage />,
  },
  {
    path: '/task/:taskId',
    element: <TaskDetailPage />,
  },
  {
    path: '/sessions',
    element: <SessionsPage />,
  },
  {
    path: '/settings',
    element: <SettingsPage />,
  },
]);
