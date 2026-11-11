import { useRef, type KeyboardEvent } from 'react';

/**
 * Handlers for a field that saves when it loses focus: Enter saves, Escape throws the
 * edit away. Escape blurs the field too, and that blur must not save the discarded text.
 */
export function useCancellableEdit(onCommit: () => void, onCancel: () => void) {
  const cancelledRef = useRef(false);
  return {
    onBlur: () => {
      if (cancelledRef.current) {
        cancelledRef.current = false;
        onCancel();
      } else {
        onCommit();
      }
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.currentTarget.blur();
      }
      if (event.key === 'Escape') {
        cancelledRef.current = true;
        event.currentTarget.blur();
      }
    },
  };
}
