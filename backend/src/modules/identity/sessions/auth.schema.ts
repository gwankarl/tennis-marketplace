import { z } from 'zod';
import { workspaceKeys } from '../accounts/workspace-access.repository.js';
import { normalizedEmailSchema } from '../registration/registration.schema.js';

/**
 * Login accepts existing passwords without registration's minimum length or
 * HIBP screening. The upper bound limits expensive password verification.
 */
const loginPasswordSchema = z.string().superRefine((value, context) => {
  if (Array.from(value).length > 1024) {
    context.addIssue({
      code: 'custom',
      message: 'Password is too long.',
    });
  }
});

export const loginRequestSchema = z
  .object({
    email: normalizedEmailSchema,
    password: loginPasswordSchema,
  })
  .strict();

export const loginResponseSchema = z
  .object({
    data: z
      .object({
        credential: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        absoluteExpiresAt: z.string().datetime({ offset: true }),
        user: z
          .object({
            id: z.string().uuid(),
            firstName: z.string(),
            lastName: z.string(),
            isAdministrator: z.boolean(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const currentSessionResponseSchema = z
  .object({
    data: z
      .object({
        user: z
          .object({
            id: z.string().uuid(),
            email: z.string().email(),
            firstName: z.string(),
            lastName: z.string(),
            isAdministrator: z.boolean(),
            workspaces: z.array(z.enum(workspaceKeys)),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const logoutResponseSchema = z
  .object({
    data: z
      .object({
        message: z.literal('Logged out.'),
      })
      .strict(),
  })
  .strict();

export type LoginRequest = z.output<typeof loginRequestSchema>;
