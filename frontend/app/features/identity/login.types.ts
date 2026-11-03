export interface LoginActionData {
  email: string;
  emailError?: string;
  passwordError?: string;
  formError?: string;
  needsVerification?: true;
}
