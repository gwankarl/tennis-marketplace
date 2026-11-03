import { data } from 'react-router';
import { submitPasswordReset } from '../features/identity/server/password-reset-flow.server';

export async function action({ request }: { request: Request }) {
  const result = await submitPasswordReset(request);
  return data(result.data, { headers: result.headers });
}
