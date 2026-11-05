import { useEffect, useRef, useState } from "react";
/** Decode only previews near the viewport instead of opening every video in a batch. */
export function usePreviewVisibility() {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(
    typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || !ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "120px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, visible };
}
