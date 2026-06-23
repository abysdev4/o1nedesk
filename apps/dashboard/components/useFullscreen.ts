"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Hook de tela cheia para um container (toolbar + video). */
export function useFullscreen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [isFull, setIsFull] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFull(document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      ref.current?.requestFullscreen?.().catch(() => {});
    }
  }, []);

  return { ref, isFull, toggle };
}
