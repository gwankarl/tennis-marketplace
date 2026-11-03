import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type {
  SessionUser,
  WorkspaceKey,
} from '../lib/security/auth-session.server';

const workspaceLinks: Record<WorkspaceKey, { label: string; to: string }> = {
  buyer: { label: 'Buyer', to: '/account' },
  seller: { label: 'Seller', to: '/seller' },
  administrator: { label: 'Administrator', to: '/admin' },
};

export function WorkspaceShell({
  user,
  children,
}: {
  user: SessionUser;
  csrfToken: string;
  children: ReactNode;
}) {
  return (
    <div className='workspace-shell'>
      <header className='workspace-shell__header'>
        <Link className='workspace-shell__brand' to='/'>
          Tennis Xpress
        </Link>

        <nav aria-label='Workspaces' className='workspace-shell__navigation'>
          <ul>
            {user.workspaces.map((workspace) => {
              const link = workspaceLinks[workspace];

              return (
                <li key={workspace}>
                  <Link to={link.to}>{link.label}</Link>
                </li>
              );
            })}
          </ul>
          <Link to='/profile'>User Profile</Link>
        </nav>
      </header>

      <div className='workspace-shell__content'>{children}</div>
    </div>
  );
}
