import { useEffect, useState } from 'react';
import { CustomSelect } from './CustomSelect';
import { IconDownload, IconRefresh, IconSave, IconServer, IconTrash, IconUpload, IconWifi } from './Icons';

const PROFILES_KEY = 'wor-editor:ftp-profiles';

function loadProfiles() {
  try { return JSON.parse(localStorage.getItem(PROFILES_KEY)) || []; } catch { return []; }
}

function persistProfiles(profiles) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

export function FtpCard({
  ftp,
  serverLabel,
  busy,
  connectLoading,
  connectMessage,
  connectProgress,
  connectTotal,
  connected,
  dirtyCount,
  canSync,
  saveState,
  onFieldChange,
  onSaveProfile,
  onTest,
  onConnect,
  onSync,
  onPublish,
  onLoadProfile,
}) {
  const [profiles, setProfiles] = useState(loadProfiles);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const canConnect = ftp.host && ftp.username && ftp.password;
  const connectLabel = connectLoading
    ? (connectTotal > 0 && connectProgress >= connectTotal
      ? 'Finalizing connection…'
      : `Loading ${connectProgress}/${connectTotal || 0}`)
    : 'Connect & Load';
  const saveLabel = saveState?.savedAt
    ? `${saveState.channel === 'ftp' ? 'Synced' : 'Loaded'} ${new Date(saveState.savedAt).toLocaleString()}`
    : null;

  const currentProfileMatch = profiles.find(
    (p) => p.host === ftp.host && p.username === ftp.username && String(p.port) === String(ftp.port),
  );
  const fallbackConnectionLabel = `${ftp.username}@${ftp.host}`;
  const preferredDisplayLabel = (serverLabel || '').trim() || currentProfileMatch?.name || fallbackConnectionLabel;

  const profileOptions = [
    ...profiles.map((p) => ({ value: p.name, label: p.name, meta: `${p.username}@${p.host}`, deletable: true })),
    { value: '__new__', label: '+ New profile' },
  ];

  useEffect(() => {
    const desiredName = (serverLabel || '').trim();
    if (!desiredName || !ftp.host || !ftp.username) return;

    setProfiles((previous) => {
      const matchIndex = previous.findIndex(
        (p) => p.host === ftp.host && p.username === ftp.username && String(p.port) === String(ftp.port || '21'),
      );
      if (matchIndex < 0) return previous;

      const matched = previous[matchIndex];
      if (matched.name === desiredName) return previous;

      const next = previous.filter((_, idx) => idx !== matchIndex);
      const conflictingNameIndex = next.findIndex((p) => p.name === desiredName);
      if (conflictingNameIndex >= 0) {
        next.splice(conflictingNameIndex, 1);
      }

      next.push({ ...matched, name: desiredName });
      persistProfiles(next);
      return next;
    });
  }, [serverLabel, ftp.host, ftp.username, ftp.port]);

  function handleSelectProfile(value) {
    if (value === '__new__') {
      setExpanded(true);
      return;
    }
    const profile = profiles.find((p) => p.name === value);
    if (!profile) return;
    onLoadProfile(profile);
    if (!ftp.password) setExpanded(true);
    else setExpanded(false);
  }

  function handleSaveProfile() {
    const name = (serverLabel || '').trim() || currentProfileMatch?.name || fallbackConnectionLabel;
    const entry = {
      name,
      host: ftp.host,
      port: ftp.port || '21',
      username: ftp.username,
      remotePaths: { ...ftp.remotePaths },
    };
    const next = profiles.filter((p) => !(
      p.host === ftp.host && p.username === ftp.username && String(p.port) === String(ftp.port)
    ));
    const nameClashIndex = next.findIndex((p) => p.name === name);
    if (nameClashIndex >= 0) {
      next.splice(nameClashIndex, 1);
    }
    next.push(entry);
    setProfiles(next);
    persistProfiles(next);
    onSaveProfile();
  }

  function handleDeleteProfile(name) {
    const next = profiles.filter((p) => p.name !== name);
    setProfiles(next);
    persistProfiles(next);
  }

  async function handleConnectClick() {
    const connectedNow = await onConnect();
    if (connectedNow) setEditing(false);
  }

  // -- Connected read-only state --
  if (connected && !editing) {
    return (
      <aside className="side-card card-shell">
        <div className="side-card__header">
          <IconServer width="18" height="18" />
          <span className="side-card__title">Server</span>
          {saveLabel && <span className="side-card__meta">{saveLabel}</span>}
        </div>

        <div className="ftp-connected">
          <div className="ftp-connected__status">
            <span className="status-dot status-dot--ok" />
            <span className="ftp-connected__info">
              {preferredDisplayLabel}
            </span>
          </div>
          <span className="ftp-connected__detail">{ftp.username}@{ftp.host}:{ftp.port || '21'}</span>
        </div>

        <button type="button" className="ftp-toggle" onClick={() => setEditing(true)}>
          Edit connection
        </button>

        <div className="ftp-actions ftp-actions--connected">
          <button
            type="button"
            className="button button--ghost ftp-resync"
            onClick={onSync}
            disabled={busy || !canSync}
            title="Re-download from server"
          >
            <IconRefresh />
          </button>
          <button
            type="button"
            className="button button--primary ftp-publish"
            onClick={onPublish}
            disabled={busy || !canSync || dirtyCount === 0}
          >
            <IconUpload /> Publish changes
          </button>
        </div>
      </aside>
    );
  }

  // -- Setup / editing state --
  return (
    <aside className="side-card card-shell">
      <div className="side-card__header">
        <IconServer width="18" height="18" />
        <span className="side-card__title">{connected ? 'Connection' : 'FTP'}</span>
        {saveLabel && <span className="side-card__meta">{saveLabel}</span>}
      </div>

      {connected && (
        <button type="button" className="ftp-toggle" style={{ marginBottom: 10, marginTop: -4 }} onClick={() => setEditing(false)}>
          ← Back to summary
        </button>
      )}

      <div className="profile-row">
        <CustomSelect
          value={currentProfileMatch?.name || ''}
          options={profileOptions}
          onChange={handleSelectProfile}
          onDelete={handleDeleteProfile}
          placeholder="Select profile…"
          className="profile-row__select"
        />
        <button type="button" className="icon-btn icon-btn--mini" title="Save current connection as profile" onClick={handleSaveProfile} disabled={!ftp.host || !ftp.username}>
          <IconSave />
        </button>
        {currentProfileMatch && (
          <button type="button" className="icon-btn icon-btn--mini icon-btn--danger" title="Delete this profile" onClick={() => handleDeleteProfile(currentProfileMatch.name)}>
            <IconTrash />
          </button>
        )}
      </div>

      <input
        className="field-input field-input--sm form-grid__full"
        type="password"
        value={ftp.password}
        onChange={(e) => onFieldChange('password', e.target.value)}
        placeholder="Password (session only)"
      />

      {!ftp.password && ftp.host && (
        <p className="ftp-hint">Enter password to enable FTP actions</p>
      )}

      <button type="button" className="ftp-toggle" onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Hide connection details' : 'Edit connection details'}
      </button>

      {expanded && (
        <div className="form-grid form-grid--compact">
          <input className="field-input field-input--sm" value={ftp.host} onChange={(e) => onFieldChange('host', e.target.value)} placeholder="Host" />
          <input className="field-input field-input--sm field-input--mono" value={ftp.port} onChange={(e) => onFieldChange('port', e.target.value)} placeholder="Port" />
          <input className="field-input field-input--sm" value={ftp.username} onChange={(e) => onFieldChange('username', e.target.value)} placeholder="Username" />
        </div>
      )}

      <div className="ftp-actions">
        <button type="button" className="icon-btn" title="Test connection" onClick={onTest} disabled={busy || !canConnect}>
          <IconWifi /> <span>Test</span>
        </button>
        <button type="button" className="button button--primary ftp-actions__connect" title="Download files from server" onClick={handleConnectClick} disabled={busy || !canConnect}>
          <IconDownload />
          <span>{connectLabel}</span>
        </button>
      </div>

      {connectLoading && (
        <p className="ftp-hint">{connectMessage || 'Syncing files…'}</p>
      )}

      {canConnect && !connected && (
        <div className="side-card__status">
          <span className="status-dot status-dot--ok" />
          <span className="side-card__meta">{ftp.username}@{ftp.host}:{ftp.port || '21'}</span>
        </div>
      )}
    </aside>
  );
}
