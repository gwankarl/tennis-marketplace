export type SellerApplicationField =
  | 'sellerType'
  | 'applicantRelationship'
  | 'proposedStoreName'
  | 'privateContactPhone'
  | 'city'
  | 'neighborhood'
  | 'sellerDescription'
  | 'inventoryCondition'
  | 'fulfillmentOption'
  | 'businessTradingName'
  | 'businessContactName'
  | 'registrationStatus'
  | 'registrationReference'
  | 'privateOperatingAddress';

export interface SellerApplicationDraft {
  id: string;
  status: 'draft';
  sellerType: 'individual' | 'commercial' | null;
  applicantRelationship: 'owner' | 'authorized_representative' | null;
  proposedStoreName: string | null;
  privateContactPhone: string | null;
  city: string | null;
  neighborhood: string | null;
  sellerDescription: string | null;
  inventoryCondition: 'new' | 'used' | 'both' | null;
  fulfillmentOption: 'pickup' | 'local_delivery' | 'both' | null;
  businessTradingName: string | null;
  businessContactName: string | null;
  registrationStatus:
    'registered' | 'registration_pending' | 'not_registered' | null;
  registrationReference: string | null;
  privateOperatingAddress: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SellerApplicationFormValues = Record<
  SellerApplicationField,
  string
>;

export type SellerApplicationFieldErrors = Partial<
  Record<SellerApplicationField, string>
>;

export type SellerApplicationLoaderData =
  | {
      state: 'ready';
      application: SellerApplicationDraft | null;
      csrfToken: string;
    }
  | { state: 'blocked'; message: string }
  | { state: 'unavailable'; message: string };

export interface SellerApplicationActionData {
  values?: SellerApplicationFormValues;
  fieldErrors?: SellerApplicationFieldErrors;
  formError?: string;
  success?: boolean;
  application?: SellerApplicationDraft;
}
