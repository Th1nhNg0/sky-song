import { useEffect } from 'react';
import { useAppStore } from '../state/store';

export function Toast() {
  const toast = useAppStore((state) => state.toast);
  const dismiss = useAppStore((state) => state.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(dismiss, toast.kind === 'error' ? 9000 : 5200);
    return () => window.clearTimeout(timer);
  }, [toast, dismiss]);

  if (!toast) return null;
  return (
    <div className={`toast toast-${toast.kind}`} role="status" aria-live="polite">
      <span className="toast-mark" aria-hidden="true" />
      <span>{toast.message}</span>
      <button type="button" className="toast-close" onClick={dismiss} aria-label="Dismiss message">
        ×
      </button>
    </div>
  );
}
