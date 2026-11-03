import { describe, expect, it } from 'vitest';
import {
  sellerApplicationDraftInputSchema,
  sellerApplicationDraftPatchSchema,
} from '../../../src/modules/seller-onboarding/seller-application-api.schema.js';

describe('seller application draft schemas', () => {
  it('accepts an empty draft and permits incomplete values', () => {
    expect(sellerApplicationDraftInputSchema.safeParse({}).success).toBe(true);

    const result = sellerApplicationDraftInputSchema.safeParse({
      sellerType: 'commercial',
    });

    expect(result.success).toBe(true);
  });

  it('trims supplied text and turns blank text into an explicit clear', () => {
    expect(
      sellerApplicationDraftInputSchema.parse({
        proposedStoreName: '  Yaoundé Racquets  ',
        city: '   ',
      }),
    ).toMatchObject({
      proposedStoreName: 'Yaoundé Racquets',
      city: null,
    });
  });

  it('measures text limits in Unicode code points', () => {
    const atLimit = '🎾'.repeat(120);
    const overLimit = '🎾'.repeat(121);

    expect(
      sellerApplicationDraftInputSchema.safeParse({
        proposedStoreName: atLimit,
      }).success,
    ).toBe(true);

    expect(
      sellerApplicationDraftInputSchema.safeParse({
        proposedStoreName: overLimit,
      }).success,
    ).toBe(false);
  });

  it('rejects control characters and invalid enum values', () => {
    expect(
      sellerApplicationDraftInputSchema.safeParse({
        neighborhood: 'Melen\nInjected',
      }).success,
    ).toBe(false);

    expect(
      sellerApplicationDraftInputSchema.safeParse({
        sellerType: 'administrator',
      }).success,
    ).toBe(false);
  });

  it('normalizes a valid contact name and phone number', () => {
    expect(
      sellerApplicationDraftInputSchema.parse({
        businessContactName: '  Amina Njoya  ',
        privateContactPhone: ' +237 6 12 34 56 78 ',
      }),
    ).toMatchObject({
      businessContactName: 'Amina Njoya',
      privateContactPhone: '+237 6 12 34 56 78',
    });
  });

  it('rejects unexpected account, permission, and lifecycle fields', () => {
    for (const input of [
      { accountId: '00000000-0000-4000-8000-000000000001' },
      { permissions: ['seller'] },
      { status: 'approved' },
      { email: 'attacker@example.test' },
    ]) {
      expect(sellerApplicationDraftInputSchema.safeParse(input).success).toBe(
        false,
      );
    }
  });

  it('allows explicit null clearing and rejects an empty PATCH', () => {
    expect(
      sellerApplicationDraftPatchSchema.safeParse({
        proposedStoreName: null,
      }).success,
    ).toBe(true);

    expect(sellerApplicationDraftPatchSchema.safeParse({}).success).toBe(false);
  });
});
