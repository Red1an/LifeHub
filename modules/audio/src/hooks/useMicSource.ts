import { useCallback, useEffect, useRef, useState } from "react";
import { MicHandle, openMic } from "../mic";
import { MicState, micErrorState } from "./useMicPitch";

/** Raw microphone node for exercises that run their own analysis. */
export function useMicSource() {
  const [state, setState] = useState<MicState>("idle");
  const [source, setSource] = useState<AudioNode | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const micRef = useRef<MicHandle | null>(null);

  const stop = useCallback(() => {
    micRef.current?.close();
    micRef.current = null;
    setSource(null);
    setStream(null);
    setState("idle");
  }, []);

  const start = useCallback(async () => {
    if (micRef.current) return;
    setState("starting");
    try {
      const mic = await openMic();
      micRef.current = mic;
      setSource(mic.source);
      setStream(mic.stream);
      setState("listening");
    } catch (error) {
      setState(micErrorState(error));
    }
  }, []);

  useEffect(() => () => micRef.current?.close(), []);

  return { state, source, stream, start, stop };
}
