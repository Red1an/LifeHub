import { useCallback, useEffect, useRef } from "react";
import { createOnsetDetector } from "../onset";
import type { Onset } from "../rhythm-analysis";

/** Collects onset candidates from a mic node while armed. */
export function useOnsetRecorder(source: AudioNode | null) {
  const onsetsRef = useRef<Onset[]>([]);
  const detectorRef = useRef<{ disconnect: () => void } | null>(null);
  const listenerRef = useRef<((onset: Onset) => void) | null>(null);

  const stop = useCallback(() => {
    detectorRef.current?.disconnect();
    detectorRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (!source) return;
    stop();
    onsetsRef.current = [];
    detectorRef.current = await createOnsetDetector(source, (onset) => {
      onsetsRef.current.push(onset);
      listenerRef.current?.(onset);
    });
  }, [source, stop]);

  const onOnset = useCallback((listener: ((onset: Onset) => void) | null) => {
    listenerRef.current = listener;
  }, []);

  useEffect(() => stop, [stop]);

  return { start, stop, onsetsRef, onOnset };
}
