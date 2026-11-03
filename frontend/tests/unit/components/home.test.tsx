import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { HomePage } from '../../../app/features/home/components/home-page';

describe('HomePage', () => {
  it('renders the accessible heading, API status, and registration link', () => {
    render(
      <MemoryRouter>
        <HomePage apiStatus='available' />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Tennis Xpress',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('API connection: Available')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Create an account' }),
    ).toHaveAttribute('href', '/register');
  });

  it('shows a safe unavailable status', () => {
    render(
      <MemoryRouter>
        <HomePage apiStatus='unavailable' />
      </MemoryRouter>,
    );

    expect(screen.getByText('API connection: Unavailable')).toBeInTheDocument();
  });
});
