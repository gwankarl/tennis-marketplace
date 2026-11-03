import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { WorkspaceShell } from '../../../app/components/workspace-shell';
import type { SessionUser } from '../../../app/lib/security/auth-session.server';

const user: SessionUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'player@example.test',
  firstName: 'Test',
  lastName: 'Player',
  isAdministrator: false,
  workspaces: ['buyer'],
};

function renderShell(workspaces: SessionUser['workspaces']) {
  const router = createMemoryRouter(
    [
      {
        path: '/account',
        element: (
          <WorkspaceShell
            user={{ ...user, workspaces }}
            csrfToken='test-csrf-token'
          >
            <main>
              <h1>Buyer overview</h1>
            </main>
          </WorkspaceShell>
        ),
      },
    ],
    { initialEntries: ['/account'] },
  );

  return render(<RouterProvider router={router} />);
}

describe('workspace shell', () => {
  it('shows only workspaces permitted by the session response', () => {
    renderShell(['buyer', 'seller']);

    const navigation = screen.getByRole('navigation', { name: 'Workspaces' });

    expect(
      within(navigation).getByRole('link', { name: 'Buyer' }),
    ).toHaveAttribute('href', '/account');
    expect(
      within(navigation).getByRole('link', { name: 'Seller' }),
    ).toHaveAttribute('href', '/seller');
    expect(
      within(navigation).queryByRole('link', { name: 'Administrator' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'User Profile' })).toHaveAttribute(
      'href',
      '/profile',
    );
  });

  it('shows the administrator workspace only when the backend permits it', () => {
    renderShell(['buyer', 'administrator']);

    const navigation = screen.getByRole('navigation', { name: 'Workspaces' });

    expect(
      within(navigation).getByRole('link', { name: 'Buyer' }),
    ).toBeInTheDocument();
    expect(
      within(navigation).getByRole('link', { name: 'Administrator' }),
    ).toHaveAttribute('href', '/admin');
    expect(
      within(navigation).queryByRole('link', { name: 'Seller' }),
    ).not.toBeInTheDocument();
  });
});
