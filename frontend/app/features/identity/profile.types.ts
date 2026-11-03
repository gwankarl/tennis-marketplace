export interface UserProfile {
  firstName: string;
  lastName: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
}

export type ProfileLoaderData =
  | {
      state: 'ready';
      profile: UserProfile;
      csrfToken: string;
    }
  | {
      state: 'unavailable';
      message: string;
    };

export interface ProfileActionData {
  firstName?: string;
  lastName?: string;
  firstNameError?: string;
  lastNameError?: string;
  formError?: string;
  success?: boolean;
}

export interface ProfileLoaderResult {
  data?: ProfileLoaderData;
  headers: Headers;
  redirectTo?: string;
}

export interface ProfileActionResult {
  data: ProfileActionData;
  headers: Headers;
  redirectTo?: string;
}
