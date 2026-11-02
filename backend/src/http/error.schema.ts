import { z } from 'zod';

export const apiErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z
          .array(
            z
              .object({
                field: z.string(),
                code: z.string(),
                message: z.string(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict(),
    meta: z
      .object({
        requestId: z.string(),
      })
      .strict(),
  })
  .strict();
