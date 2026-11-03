import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { SellerApplicationDraftForm } from '../../../app/features/seller-onboarding/components/seller-application-draft-form';
import type { SellerApplicationActionData } from '../../../app/features/seller-onboarding/seller-application.types';
import {
  SELLER_APPLICATION_DRAFT,
  SELLER_APPLICATION_FORM_VALUES,
} from '../../support/seller-application-fixtures';

function renderForm(actionData?: SellerApplicationActionData) {
  const router = createMemoryRouter(
    [
      {
        path: '/seller-application',
        element: (
          <SellerApplicationDraftForm
            application={SELLER_APPLICATION_DRAFT}
            csrfToken='test-csrf-token'
            actionData={actionData}
          />
        ),
      },
    ],
    { initialEntries: ['/seller-application'] },
  );

  return render(<RouterProvider router={router} />);
}

describe('SellerApplicationDraftForm', () => {
  it('renders the draft fields with saved values and no evidence or policy controls', () => {
    renderForm();

    expect(
      screen.getByRole('heading', { name: 'Seller application draft' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Seller type')).toHaveValue('individual');
    expect(screen.getByLabelText('Proposed store name')).toHaveValue(
      'Racquets Yaoundé',
    );
    expect(screen.getByLabelText('Private contact phone')).toHaveValue(
      '+237 6 12 34 56 78',
    );
    expect(screen.getByLabelText('City')).toHaveValue('Yaoundé');
    expect(screen.getByLabelText('Business registration status')).toHaveValue(
      '',
    );
    expect(
      screen.getByRole('button', { name: 'Save draft' }).closest('form'),
    ).toHaveAttribute('method', 'post');
    expect(
      screen.queryByLabelText(/password|session|document upload/i),
    ).toBeNull();
    expect(screen.queryByText(/accept.*policy/i)).toBeNull();
  });

  it('links field errors from a focused summary to the corresponding control', async () => {
    renderForm({
      values: { ...SELLER_APPLICATION_FORM_VALUES },
      fieldErrors: {
        privateContactPhone: 'Enter a valid contact phone number.',
      },
      formError: 'Check the highlighted fields and save the draft again.',
    });

    const summary = screen.getByRole('alert');
    expect(summary).toHaveTextContent(/check the highlighted fields/i);
    expect(summary.querySelector('a')).toHaveAttribute(
      'href',
      '#privateContactPhone',
    );
    expect(screen.getByLabelText('Private contact phone')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('Private contact phone')).toHaveAttribute(
      'aria-describedby',
      'privateContactPhone-error',
    );
    await waitFor(() => expect(summary).toHaveFocus());
  });

  it('preserves submitted values and announces a successful save', () => {
    renderForm({
      values: {
        ...SELLER_APPLICATION_FORM_VALUES,
        city: 'Douala',
      },
      success: true,
    });

    expect(screen.getByLabelText('City')).toHaveValue('Douala');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your draft has been saved.',
    );
  });

  it('disables duplicate submission while the action is pending', async () => {
    let finishAction!: () => void;
    const pendingAction = new Promise<void>((resolve) => {
      finishAction = resolve;
    });

    const router = createMemoryRouter(
      [
        {
          path: '/seller-application',
          action: async () => {
            await pendingAction;
            return null;
          },
          element: (
            <SellerApplicationDraftForm
              application={SELLER_APPLICATION_DRAFT}
              csrfToken='test-csrf-token'
            />
          ),
        },
      ],
      { initialEntries: ['/seller-application'] },
    );

    render(<RouterProvider router={router} />);
    const form = screen
      .getByRole('button', { name: 'Save draft' })
      .closest('form');

    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
    });

    await act(async () => {
      finishAction();
    });
  });
});
