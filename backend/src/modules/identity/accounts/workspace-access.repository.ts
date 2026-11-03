import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export const workspaceKeys = ['buyer', 'seller', 'administrator'] as const;
export type WorkspaceKey = (typeof workspaceKeys)[number];

export interface WorkspaceAccessRepository {
  forActiveUser(userId: string): Promise<WorkspaceKey[] | null>;
}

interface WorkspaceRow {
  status: string;
  email_verified_at: Date | null;
  is_seller: boolean;
  is_administrator: boolean;
}

function firstRow<T>(result: { rows: unknown[] }): T | undefined {
  return result.rows[0] as T | undefined;
}

/**
 * Derives the current workspaces from persisted account state and permissions.
 * Production administrator access remains blocked here until MFA is implemented.
 */
export function createWorkspaceAccessRepository(
  database: NodePgDatabase,
): WorkspaceAccessRepository {
  return {
    async forActiveUser(userId) {
      const result = await database.execute(sql`
        SELECT
          users.status,
          users.email_verified_at,
          EXISTS (
            SELECT 1
            FROM user_permissions
            WHERE user_permissions.user_id = users.id
              AND user_permissions.permission = 'seller'
          ) AS is_seller,
          EXISTS (
            SELECT 1
            FROM user_permissions
            WHERE user_permissions.user_id = users.id
              AND user_permissions.permission = 'administrator'
          ) AS is_administrator
        FROM users
        WHERE users.id = ${userId}::uuid
        LIMIT 1
      `);

      const account = firstRow<WorkspaceRow>(result);

      if (
        !account ||
        account.status !== 'active' ||
        account.email_verified_at === null
      ) {
        return null;
      }

      const workspaces: WorkspaceKey[] = ['buyer'];

      if (account.is_seller) {
        workspaces.push('seller');
      }

      if (account.is_administrator && process.env.NODE_ENV !== 'production') {
        workspaces.push('administrator');
      }

      return workspaces;
    },
  };
}
