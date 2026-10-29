import { useCallback, useEffect, useState } from 'react';

export type RouteKey = 'dashboard' | 'chat' | 'personas' | 'memory' | 'consciousness' | 'stickers' | 'creations' | 'growth' | 'neural' | 'costs' | 'plugins' | 'napcat' | 'settings';

const VALID: RouteKey[] = ['dashboard', 'chat', 'personas', 'memory', 'consciousness', 'stickers', 'creations', 'growth', 'neural', 'costs', 'plugins', 'napcat', 'settings'];

export function parseRoute(hash = window.location.hash): RouteKey {
  const raw = hash.replace(/^#\/?/, '').split('?')[0] as RouteKey;
  return VALID.includes(raw) ? raw : 'dashboard';
}

export function useHashRoute(): [RouteKey, (route: RouteKey) => void] {
  const [route, setRoute] = useState<RouteKey>(() => parseRoute());
  useEffect(() => {
    const onChange = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = useCallback((next: RouteKey) => {
    window.location.hash = `/${next}`;
    setRoute(next);
  }, []);
  return [route, navigate];
}
