import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
  );
}

interface FocusedDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement>;
  closeLabel?: string;
  className?: string;
}

/**
 * 轻量的本地 dialog 原语：不引入全局状态或依赖，负责焦点进入、循环和恢复。
 */
export function FocusedDialog({
  open,
  title,
  children,
  footer,
  onClose,
  initialFocusRef,
  closeLabel = '关闭对话框',
  className,
}: FocusedDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (!open || dialogRef.current === null) return;

    const dialog = dialogRef.current;
    lastActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const initialFocus = initialFocusRef?.current ?? focusableElements(dialog)[0] ?? dialog;
    initialFocus.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = focusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey) {
        if (currentIndex <= 0) {
          event.preventDefault();
          focusable[focusable.length - 1].focus();
        }
        return;
      }

      if (currentIndex === -1 || currentIndex === focusable.length - 1) {
        event.preventDefault();
        focusable[0].focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const lastActiveElement = lastActiveElementRef.current;
      if (lastActiveElement?.isConnected) {
        lastActiveElement.focus();
      }
    };
  }, [initialFocusRef, open]);

  if (!open) return null;

  const dialogClassName = ['focused-dialog', className].filter(Boolean).join(' ');

  return (
    <div
      className="focused-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={dialogClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="focused-dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="focused-dialog-close"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <X size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </header>
        <div className="focused-dialog-body">{children}</div>
        {footer !== undefined && <footer className="focused-dialog-footer">{footer}</footer>}
      </section>
    </div>
  );
}
