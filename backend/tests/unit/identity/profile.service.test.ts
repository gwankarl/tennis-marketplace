import { describe, expect, it, vi } from 'vitest';
import type { AccountRepository } from '../../../src/modules/identity/accounts/account.repository.js';
import { accountNameSchema } from '../../../src/modules/identity/accounts/account-name.schema.js';
import { updateProfileRequestSchema } from '../../../src/modules/identity/accounts/profile.schema.js';
import { createUserProfileService } from '../../../src/modules/identity/accounts/profile.service.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-05-01T12:00:00.000Z');

const PROFILE = {
  firstName: 'Test',
  lastName: 'Player',
  email: 'player@example.test',
  emailVerified: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('account name and profile schemas', () => {
  it('trims names and measures their limits in Unicode code points', () => {
    expect(accountNameSchema.parse('  Élodie O’Connor-Smith  ')).toBe(
      'Élodie O’Connor-Smith',
    );
    expect(accountNameSchema.parse('A'.repeat(100))).toBe('A'.repeat(100));
    expect(accountNameSchema.safeParse('A'.repeat(101)).success).toBe(false);
    expect(accountNameSchema.safeParse('Name\nInjected').success).toBe(false);
  });

  it('allows partial name updates but requires at least one name', () => {
    expect(
      updateProfileRequestSchema.parse({ firstName: '  Serena  ' }),
    ).toEqual({ firstName: 'Serena' });

    expect(updateProfileRequestSchema.safeParse({}).success).toBe(false);
  });

  it.each([
    { firstName: 'Updated', email: 'attacker@example.test' },
    { firstName: 'Updated', password: 'replacement' },
    { firstName: 'Updated', status: 'active' },
    { firstName: 'Updated', permissions: ['administrator'] },
    { firstName: 'Updated', emailVerified: true },
    { firstName: 'Updated', userId: USER_ID },
  ])('rejects protected or unknown input fields: $*', (input) => {
    expect(updateProfileRequestSchema.safeParse(input).success).toBe(false);
  });
});

describe('user profile service', () => {
  it('delegates reads and updates using the supplied user ID and clock', async () => {
    const accounts = {
      getProfileById: vi.fn(async () => PROFILE),
      updateProfileById: vi.fn(async () => ({
        ...PROFILE,
        firstName: 'Serena',
      })),
    } as unknown as Pick<
      AccountRepository,
      'getProfileById' | 'updateProfileById'
    >;

    const service = createUserProfileService({
      accounts,
      now: () => NOW,
    });

    await expect(service.get(USER_ID)).resolves.toEqual(PROFILE);
    await expect(
      service.update(USER_ID, { firstName: '  Serena  ' }),
    ).resolves.toMatchObject({ firstName: 'Serena' });

    expect(accounts.getProfileById).toHaveBeenCalledWith(USER_ID);
    expect(accounts.updateProfileById).toHaveBeenCalledWith(
      USER_ID,
      { firstName: 'Serena' },
      NOW,
    );
  });
});
