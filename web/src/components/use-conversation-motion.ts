import { useCallback, useEffect, useRef, useState } from "react";

type Phase = "queued" | "streaming" | "evidence" | "complete";
type StreamState = { key: string; characters: number; phase: Phase };

/** A finite, local streaming demonstration. The full answer is the SSR fallback. */
export function useConversationMotion(replayKey: string, text: string) {
  const elementRef = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<StreamState | null>(null);
  const ref = useCallback((element: HTMLElement | null) => { elementRef.current = element; }, []);
  const length = Array.from(text).length;

  useEffect(() => {
    const element = elementRef.current;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!element || preference.matches || !("IntersectionObserver" in window)) {
      setState(null);
      return;
    }

    let frame = 0;
    let started = false;
    let startedAt = 0;
    let shown = -1;
    let evidenceStarted = false;
    const animations: Animation[] = [];
    const duration = Math.min(2400, Math.max(1200, length * 18));
    const rows = element.querySelectorAll('[data-chat-step="row"]').length;
    const finish = () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
      setState({ key: replayKey, characters: length, phase: "complete" });
    };
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      const characters = Math.min(length, Math.floor(Math.max(0, elapsed - 200) / duration * length));
      if (characters !== shown) {
        shown = characters;
        setState({ key: replayKey, characters, phase: "streaming" });
      }
      if (elapsed >= duration + 200 && !evidenceStarted) {
        evidenceStarted = true;
        setState({ key: replayKey, characters: length, phase: "evidence" });
        let row = 0;
        for (const node of element.querySelectorAll<HTMLElement>('[data-chat-step="tool"], [data-chat-step="row"]')) {
          if (typeof node.animate !== "function") continue;
          animations.push(node.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 200,
            delay: node.dataset.chatStep === "tool" ? 0 : 180 + row++ * 140,
            fill: "backwards",
          }));
        }
      }
      if (elapsed >= duration + 200 + 380 + rows * 140) finish();
      else frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      if (visible && !started) {
        started = true;
        startedAt = performance.now();
        frame = requestAnimationFrame(tick);
      } else if (!visible && started) finish();
    }, { threshold: 0.15, rootMargin: "0px 0px -24px 0px" });
    const onPreferenceChange = () => { if (preference.matches) finish(); };
    const onVisibilityChange = () => { if (document.hidden) finish(); };

    setState({ key: replayKey, characters: 0, phase: "queued" });
    preference.addEventListener("change", onPreferenceChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
      preference.removeEventListener("change", onPreferenceChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [replayKey, text, length]);

  return {
    ref,
    characters: state?.key === replayKey ? state.characters : length,
    phase: state?.key === replayKey ? state.phase : "complete" as Phase,
  };
}
