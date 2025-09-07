import { useEffect } from 'react';
import { useParams } from 'react-router-dom';

export default function RefRedirect() {
  const params = useParams();
  useEffect(() => {
    if (params.code) {
      window.location.href = `${import.meta.env.VITE_API_BASE}/ref/${params.code}`;
    }
  }, [params.code]);
  return null;
}
