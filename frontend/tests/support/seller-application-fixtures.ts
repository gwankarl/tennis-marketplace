import type {
  SellerApplicationDraft,
  SellerApplicationFormValues,
} from '../../app/features/seller-onboarding/seller-application.types';

export const SELLER_APPLICATION_DRAFT: SellerApplicationDraft = {
  id: '00000000-0000-4000-8000-000000000001',
  status: 'draft',
  sellerType: 'individual',
  applicantRelationship: 'owner',
  proposedStoreName: 'Racquets Yaoundé',
  privateContactPhone: '+237 6 12 34 56 78',
  city: 'Yaoundé',
  neighborhood: 'Bastos',
  sellerDescription: 'Independent tennis equipment seller.',
  inventoryCondition: 'both',
  fulfillmentOption: 'pickup',
  businessTradingName: null,
  businessContactName: null,
  registrationStatus: null,
  registrationReference: null,
  privateOperatingAddress: null,
  createdAt: '2026-05-01T12:00:00.000Z',
  updatedAt: '2026-05-01T12:00:00.000Z',
};

export const SELLER_APPLICATION_FORM_VALUES: SellerApplicationFormValues = {
  sellerType: 'individual',
  applicantRelationship: 'owner',
  proposedStoreName: 'Racquets Yaoundé',
  privateContactPhone: '+237 6 12 34 56 78',
  city: 'Yaoundé',
  neighborhood: 'Bastos',
  sellerDescription: 'Independent tennis equipment seller.',
  inventoryCondition: 'both',
  fulfillmentOption: 'pickup',
  businessTradingName: '',
  businessContactName: '',
  registrationStatus: '',
  registrationReference: '',
  privateOperatingAddress: '',
};

export function sellerApplicationResponse(
  application: SellerApplicationDraft | null = SELLER_APPLICATION_DRAFT,
) {
  return { data: { application } };
}
