import { useEffect, useState } from 'react';
import { fetchJson } from '../lib/api';

export default function Profile() {
  const [user, setUser] = useState<any | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchJson('/api/users/me')
      .then((data) => {
        if (!cancelled) {
          setUser(data);
          setLoaded(true);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return null;

  if (!user) {
    return <div>Connect your wallet / Refresh</div>;
  }

  return (
    <div>
      <h1>{user.name || 'Profile'}</h1>
    </div>
  );
}
