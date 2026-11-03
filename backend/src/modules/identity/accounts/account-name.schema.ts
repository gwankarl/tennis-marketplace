import { z } from 'zod';

const ACCOUNT_NAME_CHARACTERS = /^[\p{L}\p{M} '\u2019\u2010-\u2015-]+$/u;

/** Shared trimmed name rules for registration and profile updates. */
export const accountNameSchema = z
  .string()
  .trim()
  .superRefine((value, context) => {
    const codePointLength = Array.from(value).length;

    if (codePointLength < 1 || codePointLength > 100) {
      context.addIssue({
        code: 'custom',
        message: 'Enter a name between 1 and 100 characters.',
      });
    }

    if (!ACCOUNT_NAME_CHARACTERS.test(value) || !/\p{L}/u.test(value)) {
      context.addIssue({
        code: 'custom',
        message: 'Enter a valid name.',
      });
    }
  });
