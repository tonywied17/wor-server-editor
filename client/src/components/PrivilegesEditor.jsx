import { useState } from 'react';
import { createPortal } from 'react-dom';
import { IconMinus, IconPlus, IconTrash, IconUserPlus, IconUsers, IconX } from './Icons';

function EntryStatus({ entry }) {
  if (entry.loading) return <span className="mini-badge mini-badge--neutral">Checking…</span>;
  if (entry.valid === true) return <span className="mini-badge mini-badge--ok">Valid</span>;
  if (entry.valid === false) return <span className="mini-badge mini-badge--danger">Invalid</span>;
  return <span className="mini-badge">Unverified</span>;
}

function SteamProfileModal({ steamId, onClose }) {
  const browserUrl = `https://steamcommunity.com/profiles/${encodeURIComponent(steamId)}`;
  const steamUrl = `steam://url/SteamIDPage/${encodeURIComponent(steamId)}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-card__header">
          <h3>Open Steam Profile</h3>
          <button type="button" className="modal-card__close" onClick={onClose} aria-label="Close">
            <IconX width="16" height="16" />
          </button>
        </div>
        <p className="modal-card__body">How would you like to view this profile?</p>
        <div className="modal-card__actions">
          <a
            className="button button--primary"
            href={browserUrl}
            target="_blank"
            rel="noreferrer"
            onClick={onClose}
          >
            Open in Browser
          </a>
          <a
            className="button button--ghost"
            href={steamUrl}
            onClick={onClose}
          >
            Open in Steam
          </a>
        </div>
      </div>
    </div>
  );
}

export function PrivilegesEditor({
  groups,
  onAddGroup,
  onRemoveGroup,
  onGroupNameChange,
  onAddEntry,
  onRemoveEntry,
  onEntryChange,
}) {
  const [profileModal, setProfileModal] = useState(null);

  return (
    <section className="workspace-card card-shell">
      {profileModal && createPortal(
        <SteamProfileModal steamId={profileModal} onClose={() => setProfileModal(null)} />,
        document.body,
      )}
      <div className="panel-header panel-header--tight panel-header--roster">
        <div>
          <p className="eyebrow">Privileges</p>
          <h2>Admin roster</h2>
        </div>
        <button type="button" className="icon-btn icon-btn--accent panel-header__new-group" onClick={onAddGroup}>
          <IconUsers /> <span>New group</span>
        </button>
      </div>

      <div className="stack-grid">
        {groups.map((group) => (
          <article className="group-panel" key={group.id}>
            <div className="group-panel__header">
              <input
                className="group-panel__title"
                value={group.comment}
                onChange={(event) => onGroupNameChange(group.id, event.target.value)}
                placeholder="Group name"
              />
              <div className="group-panel__toolbar">
                <button type="button" className="group-panel__action" onClick={() => onAddEntry(group.id)} title="Add admin">
                  <IconUserPlus width="15" height="15" />
                </button>
                <span className="group-panel__divider" />
                <button type="button" className="group-panel__action group-panel__action--danger" onClick={() => onRemoveGroup(group.id)} title="Remove group">
                  <IconMinus width="15" height="15" />
                </button>
              </div>
            </div>

            <div className="entry-stack">
              {group.entries.map((entry) => (
                <div className={`entry-row ${entry.valid === false ? 'is-invalid' : entry.valid === true ? 'is-valid' : ''}`} key={entry.id}>
                  <div className="entry-row__meta">
                    <button
                      type="button"
                      className="avatar-frame"
                      onClick={() => entry.steamId && setProfileModal(entry.steamId)}
                      disabled={!entry.steamId}
                      aria-label="Open Steam profile"
                    >
                      {entry.avatar ? <img src={entry.avatar} alt="Steam avatar" /> : <span>{entry.name?.slice(0, 1) || '?'}</span>}
                    </button>
                    <EntryStatus entry={entry} />
                  </div>
                  <input
                    className="field-input entry-row__steam"
                    value={entry.steamId}
                    onChange={(event) => onEntryChange(group.id, entry.id, { steamId: event.target.value })}
                    placeholder="Steam ID64 or profile URL"
                  />
                  <input
                    className="field-input entry-row__name"
                    value={entry.name}
                    onChange={(event) => onEntryChange(group.id, entry.id, { name: event.target.value })}
                    placeholder="Name"
                  />
                  <button type="button" className="row-delete" onClick={() => onRemoveEntry(group.id, entry.id)} aria-label="Remove entry">
                    <IconTrash width="14" height="14" />
                  </button>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
