import { cookies } from 'next/headers';
import HomeEntry from '../components/public/home-entry.jsx';
import Landing from '../components/public/landing.jsx';

const sessionCookieNames=['__Host-reeldesk','__Host-reeldesk-refresh','reeldesk_dev','reeldesk_dev_refresh'];

export default async function Page() {
  const browserCookies=await cookies();
  const checkSession=sessionCookieNames.some(name=>Boolean(browserCookies.get(name)?.value));
  return <HomeEntry checkSession={checkSession}><Landing/></HomeEntry>;
}
