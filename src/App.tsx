import React from 'react';
import { RouterProvider } from 'react-router-dom';
import { QueryProvider } from './providers/QueryProvider';
import NotificationContainer from './components/NotificationContainer';
import { router } from './routes';
import './App.css';

function App() {
  return (
    <QueryProvider>
      <NotificationContainer />
      <RouterProvider router={router} />
    </QueryProvider>
  );
}

export default App;
