import { z } from 'zod';
import { normalizedEmailSchema } from '../registration/registration.schema.js';

export const resendVerificationRequestSchema = z
  .object({
    email: normalizedEmailSchema,
  })
  .strict();

export const resendVerificationAcknowledgementSchema = z
  .object({
    data: z
      .object({
        message: z.literal(
          'If an account needs verification, instructions may be sent.',
        ),
      })
      .strict(),
  })
  .strict();

export type ResendVerificationRequest = z.output<
  typeof resendVerificationRequestSchema
>;

export type ResendVerificationAcknowledgement = z.output<
  typeof resendVerificationAcknowledgementSchema
>;
