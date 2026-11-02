export interface RegistrationFormValues {
  firstName: string;
  lastName: string;
  email: string;
  termsAccepted: boolean;
}

export type RegistrationField =
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'password'
  | 'confirmPassword'
  | 'termsAccepted';

export type RegistrationFormErrors = Partial<Record<RegistrationField, string>>;

export interface RegistrationActionData {
  formKey: string;
  values: RegistrationFormValues;
  errors?: RegistrationFormErrors;
  formError?: string;
  success?: true;
}
