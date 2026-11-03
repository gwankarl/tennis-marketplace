import { describe, expect, it } from 'vitest';
import { parseTestDatabaseUrl } from '../../../src/config/test-database.js';

describe('parseTestDatabaseUrl', () => {
  it('accepts the dedicated test database and login', () => {
    const url =
      'postgresql://tennis_xpress_test:example@127.0.0.1:5432/tennis_xpress_test';

    expect(
      parseTestDatabaseUrl({
        TEST_DATABASE_URL: url,
      }),
    ).toBe(url);
  });

  it('does not fall back to the development database URL', () => {
    expect(() =>
      parseTestDatabaseUrl({
        DATABASE_URL:
          'postgresql://tennis_xpress_dev:example@127.0.0.1:5432/tennis_xpress_dev',
      }),
    ).toThrow(/TEST_DATABASE_URL/);
  });

  it('rejects a development target before opening a connection', () => {
    expect(() =>
      parseTestDatabaseUrl({
        TEST_DATABASE_URL:
          'postgresql://tennis_xpress_dev:example@127.0.0.1:5432/tennis_xpress_dev',
      }),
    ).toThrow(/No connection was opened/);
  });

  it('does not include a rejected URL or password in its error', () => {
    const secretMarker = 'do-not-print-this-value';
    let errorMessage = '';

    try {
      parseTestDatabaseUrl({
        TEST_DATABASE_URL: `postgresql://tennis_xpress_dev:${secretMarker}@127.0.0.1:5432/tennis_xpress_dev`,
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toContain('tennis_xpress_test');
    expect(errorMessage).not.toContain(secretMarker);
    expect(errorMessage).not.toContain('postgresql://');
  });
});
