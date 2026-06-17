import { createBrowserRouter } from 'react-router-dom';
import ChatPage from '../pages/ChatPage';
import SessionsPage from '../pages/SessionsPage';
import SettingsPage from '../pages/SettingsPage';
import DashboardPage from '../pages/DashboardPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <ChatPage />,
  },
  {
    path: '/sessions',
    element: <SessionsPage />,
  },
  {
    path: '/settings',
    element: <SettingsPage />,
  },
  {
    path: '/dashboard',
    element: <DashboardPage />,
  },
]);
