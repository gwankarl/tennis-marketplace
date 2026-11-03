import { z } from 'zod';
import { passwordSchema } from '../registration/registration.schema.js';

export const passwordResetConfirmRequestSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    password: passwordSchema,
  })
  .strict();

export type PasswordResetConfirmRequest = z.output<
  typeof passwordResetConfirmRequestSchema
>;

export const passwordResetCompleteResponseSchema = z
  .object({
    data: z
      .object({
        message: z.literal('Password reset complete.'),
      })
      .strict(),
  })
  .strict();
