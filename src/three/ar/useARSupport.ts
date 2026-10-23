import { useEffect, useState } from 'react';

interface NavigatorXR {
  xr?: { isSessionSupported?: (mode: string) => Promise<boolean> };
}

/**
 * Detects WebXR `immersive-ar` support. True on Android Chrome / Android XR /
 * compatible headset browsers; false on iOS Safari (no WebXR) and desktop — in
 * those cases the UI offers the 2D fallback instead.
 */
export function useARSupport(): boolean {
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    let active = true;
    const xr = (navigator as Navigator & NavigatorXR).xr;
    xr?.isSessionSupported?.('immersive-ar')
      .then((ok) => active && setSupported(ok))
      .catch(() => active && setSupported(false));
    return () => {
      active = false;
    };
  }, []);

  return supported;
}
