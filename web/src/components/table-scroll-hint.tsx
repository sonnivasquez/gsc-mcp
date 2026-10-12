import { MoveHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Show a scrolling cue only when the preceding table actually overflows. */
export function TableScrollHint() {
  const hintRef = useRef<HTMLParagraphElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const region = hintRef.current?.previousElementSibling;
    const table = region?.querySelector("table");
    if (!(region instanceof HTMLElement) || !table) return;
    const measure = () => setOverflowing(region.scrollWidth > region.clientWidth + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    observer.observe(table);
    measure();
    return () => observer.disconnect();
  }, []);

  return <p ref={hintRef} hidden={!overflowing} className="home-table-hint"><MoveHorizontal aria-hidden="true" />Scroll sideways to see every column.</p>;
}
