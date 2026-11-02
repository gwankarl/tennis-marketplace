import { describe, expect, it } from 'vitest';
import { parseBackendEnv } from '../src/config/env.js';

describe('parseBackendEnv', () => {
  it('parses valid configuration and converts PORT to a number', () => {
    expect(
      parseBackendEnv({
        DATABASE_URL:
          'postgresql://dev:example@127.0.0.1:5432/tennis_xpress_dev',
        HOST: '127.0.0.1',
        PORT: '3100',
      }),
    ).toEqual({
      DATABASE_URL: 'postgresql://dev:example@127.0.0.1:5432/tennis_xpress_dev',
      HOST: '127.0.0.1',
      PORT: 3100,
    });
  });

  it('reports missing required configuration without values', () => {
    let errorMessage = '';

    try {
      parseBackendEnv({});
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toContain('DATABASE_URL');
    expect(errorMessage).not.toContain('postgresql://');
  });

  it('rejects invalid database URLs without exposing their contents', () => {
    const secretMarker = 'do-not-print-this-value';
    let errorMessage = '';

    try {
      parseBackendEnv({
        DATABASE_URL: `mysql://user:${secretMarker}@example.test/database`,
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toContain('DATABASE_URL');
    expect(errorMessage).not.toContain(secretMarker);
  });

  it('rejects invalid ports', () => {
    let errorMessage = '';

    try {
      parseBackendEnv({
        DATABASE_URL:
          'postgresql://dev:example@127.0.0.1:5432/tennis_xpress_dev',
        PORT: 'not-a-port',
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toContain('PORT');
  });
});
