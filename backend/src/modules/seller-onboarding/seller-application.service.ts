import { ApplicationError } from '../../http/application-error.js';
import type {
  SellerApplicationDraftInput,
  SellerApplicationDraftPatch,
} from './seller-application-api.schema.js';
import type {
  SellerApplicationDraftRecord,
  SellerApplicationRepository,
  SellerApplicationRepositoryResult,
} from './seller-application.repository.js';

export interface SellerApplicationService {
  getDraft(accountId: string): Promise<SellerApplicationDraftRecord | null>;
  createOrGetDraft(
    accountId: string,
    input: SellerApplicationDraftInput,
  ): Promise<SellerApplicationDraftRecord>;
  updateDraft(
    accountId: string,
    input: SellerApplicationDraftPatch,
  ): Promise<SellerApplicationDraftRecord>;
}

export interface SellerApplicationServiceDependencies {
  repository: SellerApplicationRepository;
  now?: () => Date;
}

function unwrap<T>(result: SellerApplicationRepositoryResult<T>): T {
  if (result.kind === 'ok') {
    return result.value;
  }

  switch (result.reason) {
    case 'account_ineligible':
      throw new ApplicationError(
        'FORBIDDEN',
        'An active, verified account is required to manage a seller application.',
      );
    case 'seller_exists':
      throw new ApplicationError(
        'CONFLICT',
        'This account already has seller access.',
      );
    case 'application_closed':
      throw new ApplicationError(
        'CONFLICT',
        'A seller application cannot be started for this account.',
      );
    case 'application_not_editable':
      throw new ApplicationError(
        'CONFLICT',
        'Only an editable draft can be changed.',
      );
    case 'draft_not_found':
      throw new ApplicationError(
        'NOT_FOUND',
        'No seller application draft was found.',
      );
  }
}

/** Coordinates owner-scoped draft operations without granting seller access. */
export function createSellerApplicationService(
  dependencies: SellerApplicationServiceDependencies,
): SellerApplicationService {
  const now = dependencies.now ?? (() => new Date());

  return {
    async getDraft(accountId) {
      return unwrap(await dependencies.repository.getDraft(accountId));
    },

    async createOrGetDraft(accountId, input) {
      return unwrap(
        await dependencies.repository.createOrGetDraft(accountId, input),
      );
    },

    async updateDraft(accountId, input) {
      return unwrap(
        await dependencies.repository.updateDraft(
          accountId,
          input,
          new Date(now().getTime()),
        ),
      );
    },
  };
}
