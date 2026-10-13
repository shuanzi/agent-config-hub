import { useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Portalled so table overflow and scroll containers never clip path explanations. */
export function Tooltip({
  content,
  children,
}: {
  content: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    transform?: string;
  } | null>(null);
  const show = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const above = rect.bottom + 140 > window.innerHeight;
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 308)),
      top: above ? rect.top - 8 : rect.bottom + 8,
      transform: above ? 'translateY(-100%)' : undefined,
    });
  };
  return (
    <span
      className="tooltip-trigger"
      onMouseEnter={(event) => show(event.currentTarget)}
      onFocus={(event) => show(event.currentTarget)}
      onMouseLeave={() => setPosition(null)}
      onBlur={() => setPosition(null)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setPosition(null);
      }}
    >
      {children(id)}
      <span id={id} className="sr-only">
        {content}
      </span>
      {position &&
        createPortal(
          <span className="workbench-tooltip" role="tooltip" style={position}>
            {content}
          </span>,
          document.body,
        )}
    </span>
  );
}
