import { z } from 'zod';
import { accountNameSchema } from './account-name.schema.js';

export const updateProfileRequestSchema = z
  .object({
    firstName: accountNameSchema.optional(),
    lastName: accountNameSchema.optional(),
  })
  .strict()
  .refine(
    (value) => value.firstName !== undefined || value.lastName !== undefined,
    {
      message: 'Provide at least one name to update.',
    },
  );

export type UpdateProfileRequest = z.output<typeof updateProfileRequestSchema>;

export const userProfileResponseSchema = z
  .object({
    data: z
      .object({
        profile: z
          .object({
            firstName: z.string(),
            lastName: z.string(),
            email: z.string().email(),
            emailVerified: z.boolean(),
            createdAt: z.string().datetime({ offset: true }),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type UserProfileResponse = z.output<typeof userProfileResponseSchema>;
