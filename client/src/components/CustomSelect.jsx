import { useEffect, useRef, useState } from 'react';
import { IconChevron, IconX } from './Icons';

export function CustomSelect({ value, options, onChange, onDelete, placeholder = 'Select…', className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div className={`cselect ${open ? 'is-open' : ''} ${className}`} ref={ref}>
      <button type="button" className="cselect__trigger" onClick={() => setOpen(!open)}>
        <span className={selected ? '' : 'cselect__placeholder'}>{selected ? selected.label : placeholder}</span>
        <IconChevron className="cselect__chevron" />
      </button>
      {open && (
        <ul className="cselect__menu">
          {options.map((opt) => (
            <li key={opt.value}>
              <button
                type="button"
                className={`cselect__option ${opt.value === value ? 'is-selected' : ''}`}
                onClick={() => { onChange(opt.value); setOpen(false); }}
              >
                <span className="cselect__option-text">
                  {opt.label}
                  {opt.meta && <span className="cselect__meta">{opt.meta}</span>}
                </span>
                {onDelete && opt.deletable && (
                  <span
                    role="button"
                    tabIndex={0}
                    className="cselect__delete"
                    title="Delete profile"
                    onClick={(e) => { e.stopPropagation(); onDelete(opt.value); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onDelete(opt.value); } }}
                  >
                    <IconX width="12" height="12" />
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
