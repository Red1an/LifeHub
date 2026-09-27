import { useEffect, useRef, useState } from "react";

/**
 * Tracks how long a condition (usually "singing in tune") has held, and fires
 * `onComplete` once it lasts `holdMs`. Runs on animation frames so progress
 * keeps moving even when the pitch detector skips a frame.
 */
export function useHoldTimer(active: boolean, holdMs: number, onComplete: () => void) {
  const [progress, setProgress] = useState(0);
  const activeRef = useRef(active);
  const onCompleteRef = useRef(onComplete);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!activeRef.current) {
        startRef.current = null;
        setProgress(0);
        return;
      }
      if (startRef.current === null) startRef.current = performance.now();
      const elapsed = performance.now() - startRef.current;
      if (elapsed < holdMs) {
        setProgress(elapsed / holdMs);
        return;
      }
      startRef.current = null;
      activeRef.current = false;
      setProgress(0);
      onCompleteRef.current();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [holdMs]);

  return progress;
}
