import type {
  AccountRepository,
  UserProfileRecord,
} from './account.repository.js';
import {
  updateProfileRequestSchema,
  type UpdateProfileRequest,
} from './profile.schema.js';

export interface UserProfileService {
  get(userId: string): Promise<UserProfileRecord | null>;
  update(
    userId: string,
    input: UpdateProfileRequest,
  ): Promise<UserProfileRecord | null>;
}

export interface UserProfileServiceDependencies {
  accounts: Pick<AccountRepository, 'getProfileById' | 'updateProfileById'>;
  now?: () => Date;
}

/** Reads and updates the authenticated user's safe profile projection. */
export function createUserProfileService(
  dependencies: UserProfileServiceDependencies,
): UserProfileService {
  const now = dependencies.now ?? (() => new Date());

  return {
    get(userId) {
      return dependencies.accounts.getProfileById(userId);
    },

    update(userId, input) {
      const changes = updateProfileRequestSchema.parse(input);
      return dependencies.accounts.updateProfileById(
        userId,
        changes,
        new Date(now().getTime()),
      );
    },
  };
}
