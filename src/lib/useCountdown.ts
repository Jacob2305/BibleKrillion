import { useEffect, useRef, useState } from "react";

/**
 * Milliseconds left until `deadline` (a LOCAL epoch ms), updated ~10×/s.
 * Calls `onExpire` once when it reaches zero. Pass null to stop.
 */
export function useCountdown(deadline: number | null, onExpire?: () => void): number {
  const [remaining, setRemaining] = useState(() => (deadline === null ? 0 : Math.max(0, deadline - Date.now())));
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (deadline === null) return;
    let fired = false;
    const tick = () => {
      const left = Math.max(0, deadline - Date.now());
      setRemaining(left);
      if (left === 0 && !fired) {
        fired = true;
        onExpireRef.current?.();
      }
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [deadline]);

  return remaining;
}
