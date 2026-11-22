import { useEffect, useState } from "react";

/** True once `active` has stayed true for `ms` (e.g. to say "asking the judge…" on a slow check). */
export function useSlow(active: boolean, ms = 900): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const id = window.setTimeout(() => setSlow(true), ms);
    return () => window.clearTimeout(id);
  }, [active, ms]);
  return slow;
}
