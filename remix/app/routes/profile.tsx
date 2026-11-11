import { useParams } from 'react-router';

import { ProfilePage } from '~/components/Profile/ProfilePage';

// Thin route: /profile (self) and /profile/:username (public view) both render
// the full profile page component.
export default function Profile() {
  const params = useParams();

  return <ProfilePage username={params.username} />;
}


// Optional shared preview copy. Route discovery works without this override.
export const socialPreview = {
  "title": "Your Thingtime profile",
  "description": "Your posts, photos, polls and the things you want people to find.",
  "eyebrow": "THINGTIME · PROFILE",
  "badges": [
    "Your people",
    "Your things"
  ],
  "variant": "profile"
} as const;
