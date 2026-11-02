import { useLoaderData } from 'react-router';
import { HomePage } from '../components/home-page';
import { getApiConnectionStatus } from '../lib/api-health.server';

export async function loader() {
  return {
    apiStatus: await getApiConnectionStatus(),
  };
}

export default function Home() {
  const { apiStatus } = useLoaderData<typeof loader>();

  return <HomePage apiStatus={apiStatus} />;
}
