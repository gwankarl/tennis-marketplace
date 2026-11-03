import { z } from 'zod';
import { accountNameSchema as nameSchema } from '../accounts/account-name.schema.js';

export const passwordSchema = z.string().superRefine((value, context) => {
  const codePointLength = Array.from(value).length;

  if (codePointLength < 15 || codePointLength > 128) {
    context.addIssue({
      code: 'custom',
      message: 'Password must be between 15 and 128 characters.',
    });
  }
});

export const normalizedEmailSchema = z
  .string()
  .trim()
  .max(254)
  .email()
  .toLowerCase();
/**
 * API input only. Confirmation, account status, permissions, and terms
 * metadata are deliberately excluded; the server supplies the latter fields.
 */
export const registrationRequestSchema = z
  .object({
    firstName: nameSchema,
    lastName: nameSchema,
    email: normalizedEmailSchema,
    password: passwordSchema,
    termsAccepted: z.literal(true),
  })
  .strict();

export type RegistrationRequest = z.output<typeof registrationRequestSchema>;

/** Identical acknowledgement for new and existing email addresses. */
export const registrationAcknowledgementSchema = z
  .object({
    data: z
      .object({
        message: z.literal('Registration request received.'),
      })
      .strict(),
  })
  .strict();

export type RegistrationAcknowledgement = z.output<
  typeof registrationAcknowledgementSchema
>;
