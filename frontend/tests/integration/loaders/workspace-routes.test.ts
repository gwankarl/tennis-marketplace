import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadWorkspaceAccessMock } = vi.hoisted(() => ({
  loadWorkspaceAccessMock: vi.fn(),
}));

vi.mock(
  '../../../app/features/identity/server/workspace-access.server',
  () => ({
    loadWorkspaceAccess: loadWorkspaceAccessMock,
  }),
);

import { loader as adminLoader } from '../../../app/routes/admin';
import { loader as sellerLoader } from '../../../app/routes/seller';

const headers = new Headers({ 'Cache-Control': 'no-store' });
const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'player@example.test',
  firstName: 'Test',
  lastName: 'Player',
  isAdministrator: false,
  workspaces: ['buyer'] as const,
};

beforeEach(() => {
  loadWorkspaceAccessMock.mockReset();
  loadWorkspaceAccessMock.mockResolvedValue({
    state: 'ready',
    user,
    csrfToken: 'test-csrf-token',
    headers,
  });
});

describe('workspace route loaders', () => {
  it('checks seller permission in the seller loader itself', async () => {
    const request = new Request('http://localhost:5173/seller');

    await sellerLoader({ request });

    expect(loadWorkspaceAccessMock).toHaveBeenCalledWith(
      request,
      '/seller',
      'seller',
    );
  });

  it('checks administrator permission in the administrator loader itself', async () => {
    const request = new Request('http://localhost:5173/admin');

    await adminLoader({ request });

    expect(loadWorkspaceAccessMock).toHaveBeenCalledWith(
      request,
      '/admin',
      'administrator',
    );
  });
});
