import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { AuthProvider } from '@/lib/auth/AuthContext';
import { TaskManagerProvider } from '@/lib/tasks/TaskManagerContext';
import { createQueryClient } from '@/lib/query/queryClient';
import { ErrorBoundary } from '@/components/states/ErrorBoundary';
import './index.css';

const queryClient = createQueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallbackTitle="The app failed to start">
      <RepositoryProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TaskManagerProvider>
              <App />
            </TaskManagerProvider>
          </AuthProvider>
        </QueryClientProvider>
      </RepositoryProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
