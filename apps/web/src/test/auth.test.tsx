import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoogleAuthProvider, useAuth } from '@/lib/auth/AuthContext';
import { TaskManagerProvider } from '@/lib/tasks/TaskManagerContext';
import { TopBar } from '@/components/layout/TopBar';

function TestAuthComponent() {
  const { user, isAuthenticated, signInWithGoogle, signOut, error, clearError } = useAuth();
  return (
    <div>
      <span data-testid="auth-status">{isAuthenticated ? 'Authenticated' : 'Unauthenticated'}</span>
      <span data-testid="user-id">{user?.id ?? 'no-id'}</span>
      <span data-testid="user-name">{user?.name ?? 'No user'}</span>
      <span data-testid="user-email">{user?.email ?? 'no-email'}</span>
      <span data-testid="auth-error">{error ?? 'no-error'}</span>
      <button onClick={() => signInWithGoogle()}>Login</button>
      <button onClick={() => signOut()}>Logout</button>
      <button onClick={() => clearError()}>ClearError</button>
    </div>
  );
}

describe('Google Auth System', () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as unknown as Record<string, unknown>).mi;
    delete (window as unknown as Record<string, unknown>).miSecure;
  });

  describe('Authenticated State', () => {
    beforeEach(() => {
      localStorage.setItem(
        'stratemark_auth_user',
        JSON.stringify({ id: 'local', name: 'Local Analyst', email: null }),
      );
    });

    it('renders authenticated state with default local analyst', () => {
      render(
        <GoogleAuthProvider>
          <TestAuthComponent />
        </GoogleAuthProvider>,
      );

      expect(screen.getByTestId('auth-status')).toHaveTextContent('Authenticated');
      expect(screen.getByTestId('user-id')).toHaveTextContent('local');
      expect(screen.getByTestId('user-name')).toHaveTextContent('Local Analyst');
    });

    it('renders user profile menu in TopBar when authenticated', async () => {
      const user = userEvent.setup();
      render(
        <GoogleAuthProvider>
          <TaskManagerProvider>
            <TopBar />
          </TaskManagerProvider>
        </GoogleAuthProvider>,
      );

      expect(screen.getByText('Local Analyst')).toBeInTheDocument();

      const profileBtn = screen.getByRole('button', { name: /user profile menu/i });
      await user.click(profileBtn);

      expect(screen.getByText('No email provided')).toBeInTheDocument();
      expect(screen.getByText('User Account')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    });
  });

  describe('Sign-Out & Unauthenticated State', () => {
    it('executes sign-out flow from TopBar dropdown and transitions to unauthenticated state', async () => {
      localStorage.setItem(
        'stratemark_auth_user',
        JSON.stringify({ id: 'local', name: 'Local Analyst', email: null }),
      );
      const user = userEvent.setup();
      render(
        <GoogleAuthProvider>
          <TaskManagerProvider>
            <TopBar />
          </TaskManagerProvider>
        </GoogleAuthProvider>,
      );

      const profileBtn = screen.getByRole('button', { name: /user profile menu/i });
      await user.click(profileBtn);

      const signOutBtn = screen.getByRole('button', { name: /sign out/i });
      await user.click(signOutBtn);

      // TopBar now shows Signed In status text when unauthenticated
      expect(screen.getByText('Local workspace')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /user profile menu/i })).not.toBeInTheDocument();
    });

    it('transitions to unauthenticated state and re-authenticates via signInWithGoogle', async () => {
      localStorage.setItem(
        'stratemark_auth_user',
        JSON.stringify({ id: 'local', name: 'Local Analyst', email: null }),
      );
      const user = userEvent.setup();
      render(
        <GoogleAuthProvider>
          <TestAuthComponent />
        </GoogleAuthProvider>,
      );

      const logoutBtn = screen.getByRole('button', { name: 'Logout' });
      await user.click(logoutBtn);

      expect(screen.getByTestId('auth-status')).toHaveTextContent('Unauthenticated');
      expect(screen.getByTestId('user-name')).toHaveTextContent('No user');

      const loginBtn = screen.getByRole('button', { name: 'Login' });
      await user.click(loginBtn);

      expect(screen.getByTestId('auth-status')).toHaveTextContent('Authenticated');
      expect(screen.getByTestId('user-name')).toHaveTextContent('Google Analyst');
      expect(screen.getByTestId('user-email')).toHaveTextContent('analyst@stratemark.ai');
    });
  });

  describe('Error State & Error Recovery', () => {
    it('keeps desktop auth errors out of the account-free TopBar', async () => {
      localStorage.setItem(
        'stratemark_auth_user',
        JSON.stringify({ id: 'local', name: 'Local Analyst', email: null }),
      );
      (window as unknown as Record<string, unknown>).mi = {
        googleSignIn: vi.fn().mockRejectedValue(new Error('OAuth provider popup blocked')),
      };

      const user = userEvent.setup();
      render(
        <GoogleAuthProvider>
          <TaskManagerProvider>
            <TopBar />
            <TestAuthComponent />
          </TaskManagerProvider>
        </GoogleAuthProvider>,
      );

      // Sign out, then trigger the failing sign-in programmatically (the
      // TopBar no longer carries a Google button until Firebase ships).
      const logoutBtn = screen.getByRole('button', { name: 'Logout' });
      await user.click(logoutBtn);
      const loginBtn = screen.getByRole('button', { name: 'Login' });
      await user.click(loginBtn);

      expect(screen.getByTestId('auth-error')).toHaveTextContent('OAuth provider popup blocked');
      expect(screen.getByText('Local workspace')).toBeInTheDocument();
      expect(screen.queryByText('Auth Error')).not.toBeInTheDocument();
    });

    it('clears auth error when clearError is invoked', async () => {
      localStorage.setItem(
        'stratemark_auth_user',
        JSON.stringify({ id: 'local', name: 'Local Analyst', email: null }),
      );
      (window as unknown as Record<string, unknown>).mi = {
        googleSignIn: vi.fn().mockRejectedValue(new Error('Network auth failure')),
      };

      const user = userEvent.setup();
      render(
        <GoogleAuthProvider>
          <TestAuthComponent />
        </GoogleAuthProvider>,
      );

      await user.click(screen.getByRole('button', { name: 'Logout' }));
      await user.click(screen.getByRole('button', { name: 'Login' }));

      expect(screen.getByTestId('auth-error')).toHaveTextContent('Network auth failure');

      await user.click(screen.getByRole('button', { name: 'ClearError' }));

      expect(screen.getByTestId('auth-error')).toHaveTextContent('no-error');
    });
  });
});
