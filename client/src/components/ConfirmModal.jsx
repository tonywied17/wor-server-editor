import { createPortal } from 'react-dom';
import { IconX } from './Icons';

export function ConfirmModal({ state, onResolve }) {
  if (!state) return null;

  return createPortal(
    <div className="modal-backdrop" onClick={() => onResolve(false)}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-card__header">
          <h3>{state.title}</h3>
          <button type="button" className="modal-card__close" onClick={() => onResolve(false)} aria-label="Close">
            <IconX width="16" height="16" />
          </button>
        </div>
        <p className="modal-card__body">{state.message}</p>
        <div className="modal-card__actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={() => onResolve(false)}
          >
            {state.cancelLabel}
          </button>
          <button
            type="button"
            className={`button ${state.tone === 'danger' ? 'button--danger' : 'button--primary'}`}
            onClick={() => onResolve(true)}
            autoFocus
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
