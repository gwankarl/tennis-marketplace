import type {
  AuthenticatedSession,
  UserSessionRepository,
} from './user-session.repository.js';
import {
  ADMINISTRATOR_SESSION_IDLE_TIMEOUT_MS,
  STANDARD_SESSION_IDLE_TIMEOUT_MS,
} from './session-policy.js';
import { hashSessionCredential } from './session-credential.js';

export interface SessionService {
  current(credential: string): Promise<AuthenticatedSession | null>;
  logout(credential: string): Promise<boolean>;
}

export interface SessionServiceDependencies {
  repository: UserSessionRepository;
  now?: () => Date;
}

/** Validates and touches sessions using the current account policy. */
export function createSessionService(
  dependencies: SessionServiceDependencies,
): SessionService {
  const now = dependencies.now ?? (() => new Date());

  return {
    async current(credential) {
      const credentialHash = hashSessionCredential(credential);

      if (!credentialHash) {
        return null;
      }

      return dependencies.repository.validateAndTouch(credentialHash, {
        now: new Date(now().getTime()),
        standardIdleTimeoutMs: STANDARD_SESSION_IDLE_TIMEOUT_MS,
        administratorIdleTimeoutMs: ADMINISTRATOR_SESSION_IDLE_TIMEOUT_MS,
      });
    },

    async logout(credential) {
      const credentialHash = hashSessionCredential(credential);

      if (!credentialHash) {
        return false;
      }

      return dependencies.repository.revokeCurrentSession(
        credentialHash,
        new Date(now().getTime()),
      );
    },
  };
}
