import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomePage } from '../app/components/home-page';

describe('HomePage', () => {
  it('renders the accessible heading and available API status', () => {
    render(<HomePage apiStatus='available' />);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Tennis Xpress',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('API connection: Available')).toBeInTheDocument();
  });

  it('shows a safe unavailable status', () => {
    render(<HomePage apiStatus='unavailable' />);

    expect(screen.getByText('API connection: Unavailable')).toBeInTheDocument();
  });
});
