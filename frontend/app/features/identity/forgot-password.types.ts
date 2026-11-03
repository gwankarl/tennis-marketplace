export interface ForgotPasswordActionData {
  email: string;
  emailError?: string;
  formError?: string;
  success?: true;
}

export interface ForgotPasswordActionResult {
  data: ForgotPasswordActionData;
  headers: Headers;
}
