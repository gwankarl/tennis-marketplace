import { z } from 'zod';
import { accountNameSchema } from '../identity/accounts/account-name.schema.js';
import {
  sellerApplicantRelationship as applicantRelationshipType,
  sellerFulfillmentOption as fulfillmentOptionType,
  sellerInventoryCondition as inventoryConditionType,
  sellerRegistrationStatus as registrationStatusType,
  sellerType as sellerTypeType,
} from './seller-application.schema.js';

const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

function optionalDraftText(maxCodePoints: number) {
  return z
    .string()
    .transform((raw, context) => {
      const value = raw.trim();

      if (CONTROL_CHARACTERS.test(value)) {
        context.addIssue({
          code: 'custom',
          message: 'Control characters are not allowed.',
        });
      }

      if (Array.from(value).length > maxCodePoints) {
        context.addIssue({
          code: 'custom',
          message: `Enter no more than ${maxCodePoints} characters.`,
        });
      }

      return value.length === 0 ? null : value;
    })
    .nullable()
    .optional();
}

const optionalPhone = z
  .string()
  .transform((raw, context) => {
    const value = raw.trim();

    if (
      CONTROL_CHARACTERS.test(value) ||
      (value.length > 0 && !/^[+0-9(). -]+$/u.test(value)) ||
      (value.length > 0 && !/[0-9]/u.test(value))
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Enter a phone number using digits and common phone punctuation.',
      });
    }

    if (Array.from(value).length > 32) {
      context.addIssue({
        code: 'custom',
        message: 'Enter no more than 32 characters.',
      });
    }

    return value.length === 0 ? null : value;
  })
  .nullable()
  .optional();

const optionalBusinessContactName = z
  .string()
  .transform((raw, context) => {
    const value = raw.trim();

    if (value.length === 0) {
      return null;
    }

    const parsed = accountNameSchema.safeParse(value);

    if (!parsed.success) {
      context.addIssue({
        code: 'custom',
        message: 'Enter a valid business contact name.',
      });
      return value;
    }

    return parsed.data;
  })
  .nullable()
  .optional();

/** Draft fields are optional; completeness belongs to the later submission step. */
export const sellerApplicationDraftInputSchema = z
  .object({
    sellerType: z.enum(sellerTypeType.enumValues).nullable().optional(),
    applicantRelationship: z
      .enum(applicantRelationshipType.enumValues)
      .nullable()
      .optional(),
    proposedStoreName: optionalDraftText(120),
    privateContactPhone: optionalPhone,
    city: optionalDraftText(100),
    neighborhood: optionalDraftText(100),
    sellerDescription: optionalDraftText(500),
    inventoryCondition: z
      .enum(inventoryConditionType.enumValues)
      .nullable()
      .optional(),
    fulfillmentOption: z
      .enum(fulfillmentOptionType.enumValues)
      .nullable()
      .optional(),
    businessTradingName: optionalDraftText(150),
    businessContactName: optionalBusinessContactName,
    registrationStatus: z
      .enum(registrationStatusType.enumValues)
      .nullable()
      .optional(),
    registrationReference: optionalDraftText(100),
    privateOperatingAddress: optionalDraftText(250),
  })
  .strict();

/**
 * Fastify supplies null to validation when a request has no body.
 * Treat bodyless draft creation as an empty partial draft.
 */
export const sellerApplicationDraftCreateBodySchema = z.preprocess(
  (body) => (body === null ? {} : body),
  sellerApplicationDraftInputSchema,
);

export const sellerApplicationDraftPatchSchema =
  sellerApplicationDraftInputSchema.refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    { message: 'Provide at least one draft field to update.' },
  );

const sellerApplicationDraftSchema = z
  .object({
    id: z.string().uuid(),
    status: z.literal('draft'),
    sellerType: z.enum(sellerTypeType.enumValues).nullable(),
    applicantRelationship: z
      .enum(applicantRelationshipType.enumValues)
      .nullable(),
    proposedStoreName: z.string().nullable(),
    privateContactPhone: z.string().nullable(),
    city: z.string().nullable(),
    neighborhood: z.string().nullable(),
    sellerDescription: z.string().nullable(),
    inventoryCondition: z.enum(inventoryConditionType.enumValues).nullable(),
    fulfillmentOption: z.enum(fulfillmentOptionType.enumValues).nullable(),
    businessTradingName: z.string().nullable(),
    businessContactName: z.string().nullable(),
    registrationStatus: z.enum(registrationStatusType.enumValues).nullable(),
    registrationReference: z.string().nullable(),
    privateOperatingAddress: z.string().nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const sellerApplicationDraftResponseSchema = z
  .object({
    data: z
      .object({
        application: sellerApplicationDraftSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export type SellerApplicationDraftInput = z.output<
  typeof sellerApplicationDraftInputSchema
>;
export type SellerApplicationDraftPatch = z.output<
  typeof sellerApplicationDraftPatchSchema
>;
