'use client';

import { useEffect, useState } from 'react';

/**
 * Cycles through short phrases, each blurring in. Screen readers get the first phrase only, and
 * nothing moves when the visitor prefers reduced motion.
 */
export function RotatingWords({ words, interval = 2600 }: { words: string[]; interval?: number }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setIndex(i => (i + 1) % words.length), interval);
    return () => clearInterval(id);
  }, [words.length, interval]);

  return (
    <>
      <span className="sr-only">{words[0]}</span>
      <span key={index} aria-hidden className="word-in inline-block">
        {words[index]}
      </span>
    </>
  );
}
