import { z } from 'zod';
import { normalizedEmailSchema } from '../registration/registration.schema.js';

export const passwordResetRequestSchema = z
  .object({
    email: normalizedEmailSchema,
  })
  .strict();

export const passwordResetAcknowledgementSchema = z
  .object({
    data: z
      .object({
        message: z.literal(
          'If an account is eligible for a password reset, instructions may be sent.',
        ),
      })
      .strict(),
  })
  .strict();

export type PasswordResetRequest = z.output<typeof passwordResetRequestSchema>;

export type PasswordResetAcknowledgement = z.output<
  typeof passwordResetAcknowledgementSchema
>;
