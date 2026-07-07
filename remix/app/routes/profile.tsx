import { useParams } from 'react-router';

import { ProfilePage } from '~/components/Profile/ProfilePage';

// Thin route: /profile (self) and /profile/:username (public view) both render
// the full profile page component.
export default function Profile() {
  const params = useParams();

  return <ProfilePage username={params.username} />;
}
