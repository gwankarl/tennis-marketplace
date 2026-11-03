export type PasswordResetPageState = 'ready' | 'missing' | 'invalid';

export interface PasswordResetLoaderData {
  state: PasswordResetPageState;
  csrfToken: string;
}

export type PasswordResetActionState =
  | 'success'
  | 'invalid'
  | 'missing'
  | 'csrf-failure'
  | 'validation-error'
  | 'rate-limited'
  | 'temporary-failure';

export interface PasswordResetActionData {
  state: PasswordResetActionState;
  formError?: string;
  passwordError?: string;
  confirmPasswordError?: string;
}
