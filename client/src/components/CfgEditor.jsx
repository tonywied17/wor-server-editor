import { CustomSelect } from './CustomSelect';
import { CfgQuickSettings } from './CfgQuickSettings';
import { IconLock, IconMinus, IconPlus, IconTrash } from './Icons';

const QUICK_MANAGED_KEYS = new Set([
  'online.server.name',
  'online.server.capacity',
  'online.server.password',
  'sv_gamerules',
  'g_drillcampfaction',
  'demotion.system.enabled',
  'g_teamsizemaxuserpercentagedifference',
]);

const PROTECTED_KEYS = new Set([
  'sv_bind',
  'sv_port',
  'online.server.port',
  'online.server.steamport',
  'online.server.steam.accounttoken',
]);

function shouldHideKey(key) {
  return QUICK_MANAGED_KEYS.has(String(key || '').trim().toLowerCase());
}

function isProtectedKey(key) {
  return PROTECTED_KEYS.has(String(key || '').trim().toLowerCase());
}

export function CfgEditor({
  entries,
  presets,
  duplicateCount,
  onSetValues,
  onAddLine,
  onAddPreset,
  onRemoveGroup,
  onRemoveEntry,
  onUpdateEntry,
  onUpdateGroupName,
}) {
  const visibleEntries = entries
    .map((item) => {
      if (item.type !== 'group') return shouldHideKey(item.key) ? null : item;
      const filteredGroupEntries = item.entries.filter((entry) => !shouldHideKey(entry.key));
      if (!filteredGroupEntries.length) return null;
      return { ...item, entries: filteredGroupEntries };
    })
    .filter(Boolean);

  return (
    <section className="workspace-card card-shell">
      <div className="panel-header panel-header--tight panel-header--config">
        <div>
          <p className="eyebrow">Configuration</p>
          <h2>Server configuration</h2>
        </div>
        <div className="button-row button-row--compact panel-header__actions">
          <button type="button" className="icon-btn panel-header__action-btn" onClick={onAddLine}>
            <IconPlus /> <span>Add key</span>
          </button>
          <CustomSelect
            className="panel-header__preset"
            value=""
            options={presets.map((p) => ({ value: p.name, label: p.name }))}
            onChange={(value) => {
              const preset = presets.find((item) => item.name === value);
              if (preset) onAddPreset(preset);
            }}
            placeholder="Add preset…"
          />
        </div>
      </div>

      <CfgQuickSettings entries={entries} onSetValues={onSetValues} />

      {duplicateCount > 0 ? (
        <div className="warning-banner">
          Duplicate configuration keys are blocking export. Remove or rename duplicates before saving.
        </div>
      ) : null}

      <div className="entry-stack">
        {visibleEntries.map((item) => {
          if (item.type === 'group') {
            return (
              <article className="group-panel" key={item.id}>
                <div className="group-panel__header">
                  <input
                    className="group-panel__title"
                    value={item.name}
                    onChange={(event) => onUpdateGroupName(item.id, event.target.value)}
                  />
                  <div className="group-panel__toolbar">
                    <button type="button" className="group-panel__action group-panel__action--danger" onClick={() => onRemoveGroup(item.id)} title="Remove group">
                      <IconMinus width="15" height="15" />
                    </button>
                  </div>
                </div>
                <div className="entry-stack">
                  {item.entries.map((entry) => {
                    const locked = isProtectedKey(entry.key);
                    return (
                      <div className={`cfg-row ${entry.duplicate ? 'is-invalid' : ''} ${locked ? 'is-locked' : ''}`} key={entry.id}>
                        <input
                          className="field-input field-input--mono"
                          value={entry.key}
                          readOnly={locked}
                          onChange={(event) => onUpdateEntry(entry.id, { key: event.target.value })}
                          placeholder="key"
                        />
                        <input
                          className="field-input field-input--mono"
                          value={entry.value}
                          readOnly={locked}
                          onChange={(event) => onUpdateEntry(entry.id, { value: event.target.value })}
                          placeholder="value"
                        />
                        {locked ? (
                          <span className="row-lock" title="Server-required key"><IconLock width="14" height="14" /></span>
                        ) : (
                          <button type="button" className="row-delete" onClick={() => onRemoveEntry(entry.id)} aria-label="Remove entry">
                            <IconTrash width="14" height="14" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          }
          const locked = isProtectedKey(item.key);
          return (
            <div className={`cfg-row ${item.duplicate ? 'is-invalid' : ''} ${locked ? 'is-locked' : ''}`} key={item.id}>
              <input
                className="field-input field-input--mono"
                value={item.key}
                readOnly={locked}
                onChange={(event) => onUpdateEntry(item.id, { key: event.target.value })}
                placeholder="key"
              />
              <input
                className="field-input field-input--mono"
                value={item.value}
                readOnly={locked}
                onChange={(event) => onUpdateEntry(item.id, { value: event.target.value })}
                placeholder="value"
              />
              {locked ? (
                <span className="row-lock" title="Server-required key"><IconLock width="14" height="14" /></span>
              ) : (
                <button type="button" className="row-delete" onClick={() => onRemoveEntry(item.id)} aria-label="Remove entry">
                  <IconTrash width="14" height="14" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
