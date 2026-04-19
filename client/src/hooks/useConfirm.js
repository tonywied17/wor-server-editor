import { useCallback, useRef, useState } from 'react';

/**
 * Promise-based confirm dialog hook.
 *
 * const { confirm, confirmState, resolveConfirm } = useConfirm();
 * const ok = await confirm('Delete this?', { title: 'Confirm', confirmLabel: 'Delete' });
 *
 * Render <ConfirmModal> using confirmState / resolveConfirm.
 */
export function useConfirm() {
  const [confirmState, setConfirmState] = useState(null);
  const resolverRef = useRef(null);

  const confirm = useCallback((message, options = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setConfirmState({
        message,
        title: options.title || 'Confirm',
        confirmLabel: options.confirmLabel || 'Yes',
        cancelLabel: options.cancelLabel || 'Cancel',
        tone: options.tone || 'default',
      });
    });
  }, []);

  const resolveConfirm = useCallback((value) => {
    if (resolverRef.current) {
      resolverRef.current(value);
      resolverRef.current = null;
    }
    setConfirmState(null);
  }, []);

  return { confirm, confirmState, resolveConfirm };
}
