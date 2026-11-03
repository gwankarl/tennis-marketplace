import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { UserProfileForm } from '../../../app/features/identity/components/user-profile-form';
import type { ProfileActionData } from '../../../app/features/identity/profile.types';

const profile = {
  firstName: 'Serena',
  lastName: 'Williams',
  email: 'player@example.test',
  emailVerified: true,
  createdAt: '2026-01-02T00:00:00.000Z',
};

function renderProfile(actionData?: ProfileActionData) {
  const router = createMemoryRouter(
    [
      {
        path: '/profile',
        element: (
          <UserProfileForm
            profile={profile}
            csrfToken='test-csrf-token'
            actionData={actionData}
          />
        ),
      },
    ],
    { initialEntries: ['/profile'] },
  );

  return render(<RouterProvider router={router} />);
}

describe('UserProfileForm', () => {
  it('shows the safe read-only fields and editable accessible names', () => {
    renderProfile();

    expect(
      screen.getByRole('heading', { name: 'User Profile' }),
    ).toBeInTheDocument();
    expect(screen.getByText('player@example.test')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText('2026-01-02')).toBeInTheDocument();

    expect(screen.getByLabelText('First name')).toHaveValue('Serena');
    expect(screen.getByLabelText('First name')).toHaveAttribute(
      'autocomplete',
      'given-name',
    );
    expect(screen.getByLabelText('Last name')).toHaveValue('Williams');
    expect(screen.getByLabelText('Last name')).toHaveAttribute(
      'autocomplete',
      'family-name',
    );

    expect(screen.getByLabelText('First name').tagName).toBe('INPUT');
    expect(screen.queryByLabelText(/password|permission|status/i)).toBeNull();
    expect(screen.queryByText(/session credential/i)).toBeNull();
  });

  it('links field errors from the focused error summary to their inputs', async () => {
    renderProfile({
      firstName: 'Bad Name',
      lastName: 'Williams',
      firstNameError: 'Enter a valid first name.',
    });

    const summary = screen.getByRole('alert');
    expect(summary).toHaveTextContent('Enter a valid first name.');
    expect(summary.querySelector('a')).toHaveAttribute('href', '#firstName');
    expect(screen.getByLabelText('First name')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('First name')).toHaveAttribute(
      'aria-describedby',
      'firstName-error',
    );

    await waitFor(() => expect(summary).toHaveFocus());
  });

  it('shows safe general failures and keeps the submitted non-sensitive names', () => {
    renderProfile({
      firstName: 'Serena',
      lastName: 'Williams',
      formError: 'We could not update your profile. Please try again later.',
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      /could not update your profile/i,
    );
    expect(screen.getByLabelText('First name')).toHaveValue('Serena');
    expect(screen.getByLabelText('Last name')).toHaveValue('Williams');
  });

  it('announces a successful update', () => {
    renderProfile({
      firstName: 'Serena',
      lastName: 'Williams',
      success: true,
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Your profile has been updated.',
    );
  });

  it('disables submission and announces pending state', async () => {
    let finishAction!: () => void;
    const pendingAction = new Promise<void>((resolve) => {
      finishAction = resolve;
    });

    const router = createMemoryRouter(
      [
        {
          path: '/profile',
          action: async () => {
            await pendingAction;
            return null;
          },
          element: (
            <UserProfileForm profile={profile} csrfToken='test-csrf-token' />
          ),
        },
      ],
      { initialEntries: ['/profile'] },
    );

    render(<RouterProvider router={router} />);
    const form = screen
      .getByRole('button', { name: 'Save profile' })
      .closest('form');

    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    });

    await act(async () => {
      finishAction();
    });
  });
});
