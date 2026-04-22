import { useMemo } from 'react';
import { CustomSelect } from './CustomSelect';
import { gameModePresets, knownServerKeys } from '../lib/cfgPresets';

function getCfgValue(entries, key) {
  const lowerKey = key.toLowerCase();
  for (const item of entries) {
    if (item.type === 'group') {
      const match = item.entries.find((e) => e.key.toLowerCase() === lowerKey);
      if (match) return match.value;
    } else if (item.key.toLowerCase() === lowerKey) {
      return item.value;
    }
  }
  return '';
}

function detectCurrentPreset(entries) {
  const rules = getCfgValue(entries, 'sv_gamerules').toLowerCase();
  const faction = getCfgValue(entries, 'g_drillcampfaction');
  if (!rules) return null;
  return gameModePresets.find((p) => {
    const pRules = p.sets.sv_gamerules.toLowerCase();
    if (pRules !== rules) return false;
    if (p.sets.g_drillcampfaction) return p.sets.g_drillcampfaction === faction;
    return true;
  })?.id || null;
}

function QuickField({ label, description, className = '', children }) {
  return (
    <div className={`quick-field ${className}`.trim()}>
      <label className="quick-field__label">{label}</label>
      {children}
      {description && <p className="quick-field__hint">{description}</p>}
    </div>
  );
}

export function CfgQuickSettings({ entries, onSetValues }) {
  const serverName = getCfgValue(entries, 'Online.Server.Name');
  const maxSlots = getCfgValue(entries, 'Online.Server.Capacity');
  const serverPassword = getCfgValue(entries, 'Online.Server.Password');
  const demotionEnabled = getCfgValue(entries, 'Demotion.System.Enabled') !== '0';
  const teamAutoBalanceDisabled = getCfgValue(entries, 'g_teamSizeMaxUserPercentageDifference') === '1';
  const currentPresetId = useMemo(() => detectCurrentPreset(entries), [entries]);

  const presetOptions = useMemo(() => {
    const groups = new Map();
    for (const p of gameModePresets) {
      if (!groups.has(p.category)) groups.set(p.category, []);
      groups.get(p.category).push({ value: p.id, label: p.label });
    }
    const result = [];
    for (const [, items] of groups) {
      result.push(...items);
    }
    return result;
  }, []);

  function handlePresetChange(presetId) {
    const preset = gameModePresets.find((p) => p.id === presetId);
    if (!preset) return;
    onSetValues(preset.sets, preset.removes);
  }

  function handleQuickValueChange(key, value) {
    onSetValues({ [key]: value }, []);
  }

  const isDrillCamp = getCfgValue(entries, 'sv_gamerules').toLowerCase() === 'drillcamp';
  const faction = getCfgValue(entries, 'g_drillcampfaction');

  return (
    <div className="quick-settings">
      <div className="quick-settings__header">
        <p className="quick-settings__title">Quick settings</p>
      </div>

      <div className="quick-settings__grid">
        <QuickField label={knownServerKeys['Online.Server.Name'].label} description={knownServerKeys['Online.Server.Name'].description}>
          <input
            className="field-input"
            value={serverName}
            onChange={(e) => handleQuickValueChange('Online.Server.Name', e.target.value)}
            placeholder="My Server"
          />
        </QuickField>

        <QuickField label="Game mode" description={knownServerKeys.sv_gamerules.description}>
          <CustomSelect
            className="quick-settings__select"
            value={currentPresetId || ''}
            options={presetOptions}
            onChange={handlePresetChange}
            placeholder="Select game mode…"
          />
        </QuickField>

        <QuickField label={knownServerKeys['Online.Server.Capacity'].label} description={knownServerKeys['Online.Server.Capacity'].description}>
          <input
            className="field-input"
            type="number"
            value={maxSlots}
            onChange={(e) => handleQuickValueChange('Online.Server.Capacity', e.target.value)}
            placeholder="400"
          />
        </QuickField>

        {isDrillCamp && (
          <QuickField label={knownServerKeys['g_drillcampfaction'].label} description={knownServerKeys['g_drillcampfaction'].description}>
            <div className="faction-toggle">
              <button
                type="button"
                className={`faction-toggle__btn ${faction === '1' ? 'is-active' : ''}`}
                onClick={() => handleQuickValueChange('g_drillcampfaction', '1')}
              >
                USA
              </button>
              <button
                type="button"
                className={`faction-toggle__btn ${faction === '2' ? 'is-active' : ''}`}
                onClick={() => handleQuickValueChange('g_drillcampfaction', '2')}
              >
                CSA
              </button>
            </div>
          </QuickField>
        )}

        <QuickField label={knownServerKeys['Online.Server.Password'].label} description={knownServerKeys['Online.Server.Password'].description}>
          <input
            className="field-input"
            value={serverPassword}
            onChange={(e) => handleQuickValueChange('Online.Server.Password', e.target.value)}
            placeholder="No password"
          />
        </QuickField>

        <QuickField label={knownServerKeys['Demotion.System.Enabled'].label} description={knownServerKeys['Demotion.System.Enabled'].description}>
          <button
            type="button"
            className={`quick-switch ${demotionEnabled ? 'is-on' : ''}`}
            aria-pressed={demotionEnabled}
            onClick={() => handleQuickValueChange('Demotion.System.Enabled', demotionEnabled ? '0' : '1')}
          >
            <span className="quick-switch__track">
              <span className="quick-switch__knob" />
            </span>
            <span className="quick-switch__label">{demotionEnabled ? 'Enabled' : 'Disabled'}</span>
          </button>
        </QuickField>

        <QuickField label={knownServerKeys.g_teamSizeMaxUserPercentageDifference.label} description={knownServerKeys.g_teamSizeMaxUserPercentageDifference.description}>
          <button
            type="button"
            className={`quick-switch ${teamAutoBalanceDisabled ? '' : 'is-on'}`}
            aria-pressed={!teamAutoBalanceDisabled}
            onClick={() => {
              if (teamAutoBalanceDisabled) {
                onSetValues({}, ['g_teamSizeMaxUserPercentageDifference']);
              } else {
                onSetValues({ g_teamSizeMaxUserPercentageDifference: '1' }, []);
              }
            }}
          >
            <span className="quick-switch__track">
              <span className="quick-switch__knob" />
            </span>
            <span className="quick-switch__label">{teamAutoBalanceDisabled ? 'Disabled' : 'Enabled'}</span>
          </button>
        </QuickField>

      </div>
    </div>
  );
}
