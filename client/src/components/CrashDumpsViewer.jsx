import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ftpDownload, ftpDownloadBinary, ftpListCrashes, ftpListLogs } from '../lib/api';
import { formatBytes, formatRelativeTime } from '../lib/logParser';
import { buildFtpEndpointKey, crashViewCache } from '../lib/viewCache';
import { IconDownload, IconFile, IconRefresh, IconX } from './Icons';
import { FtpAuthPrompt } from './LogsViewer';

const CRASH_DIR = '/Diagnostics';
const REPORT_URL = 'https://warofrights.com/errorreporter';

function base64ToBlob(base64, mime = 'application/octet-stream') {
  const bytes = atob(base64);
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) buffer[i] = bytes.charCodeAt(i);
  return new Blob([buffer], { type: mime });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function CrashDumpsViewer({
  ftp,
  ftpReady,
  onRequestConnect,
  notify,
  refreshToken = 0,
  onRefreshed,
  shortcutCommand,
}) {
  const endpointKey = buildFtpEndpointKey(ftp);
  const canUseCache = crashViewCache.endpointKey === endpointKey;
  const [entries, setEntries] = useState(() => (canUseCache ? crashViewCache.entries : []));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyPath, setBusyPath] = useState(null);
  const [selection, setSelection] = useState(() => new Set(canUseCache ? crashViewCache.selectionPaths : []));
  const [showReportModal, setShowReportModal] = useState(false);

  const ftpPayload = useMemo(() => ({
    host: ftp.host?.trim(),
    port: ftp.port ? Number(ftp.port) : 21,
    username: ftp.username?.trim(),
    password: ftp.password,
  }), [ftp.host, ftp.port, ftp.username, ftp.password]);

  const refresh = useCallback(async (options = {}) => {
    const { repopulate = false } = options;
    if (!ftpReady) return;
    if (repopulate) {
      setEntries([]);
      setSelection(new Set());
    }
    setLoading(true);
    setError('');
    try {
      // Pull crash files from /Diagnostics in parallel with the latest root log.
      // The /Diagnostics/Server.log is frequently a 0-byte stub; the real
      // up-to-date log lives at /server(N).log (same list the Logs tab uses).
      const [crashResult, logResult] = await Promise.all([
        ftpListCrashes({ ...ftpPayload, dir: CRASH_DIR }),
        ftpListLogs({ ...ftpPayload, dir: '/', limit: 1 }).catch(() => ({ entries: [] })),
      ]);
      const crashEntries = crashResult.entries || [];
      const latestRootLog = (logResult.entries || [])[0];
      const merged = [...crashEntries];
      if (latestRootLog && (latestRootLog.size || 0) > 0) {
        // Avoid duplicating by path.
        if (!merged.some((e) => e.path === latestRootLog.path)) {
          merged.push({
            name: latestRootLog.name,
            path: latestRootLog.path,
            size: latestRootLog.size,
            modifiedAt: latestRootLog.modifiedAt,
          });
        }
      }
      merged.sort((a, b) => {
        const aT = a.modifiedAt ? Date.parse(a.modifiedAt) : 0;
        const bT = b.modifiedAt ? Date.parse(b.modifiedAt) : 0;
        return bT - aT;
      });
      const fetchedAt = new Date().toISOString();
      setEntries(merged);
      setSelection((prev) => {
        const validPaths = new Set(merged.map((entry) => entry.path));
        return new Set([...prev].filter((path) => validPaths.has(path)));
      });
      crashViewCache.fetchedAt = fetchedAt;
      onRefreshed?.({ fetchedAt, count: merged.length });
    } catch (err) {
      setError(err.message || 'Failed to scan crash dumps.');
    } finally {
      setLoading(false);
    }
  }, [ftpPayload, ftpReady, onRefreshed]);

  useEffect(() => {
    if (!ftpReady) return;
    if (entries.length > 0) return;
    refresh({ repopulate: false });
  }, [ftpReady, entries.length, refresh]);

  useEffect(() => {
    if (!ftpReady) return;
    if (!refreshToken) return;
    refresh({ repopulate: true });
  }, [refreshToken]);

  useEffect(() => {
    if (shortcutCommand === 'rescan') refresh({ repopulate: true });
  }, [shortcutCommand]);

  useEffect(() => {
    crashViewCache.endpointKey = endpointKey;
    crashViewCache.entries = entries;
    crashViewCache.selectionPaths = [...selection];
  }, [endpointKey, entries, selection]);

  async function handleDownloadOne(entry) {
    if (!entry || (entry.size || 0) <= 0) {
      notify?.(`${entry?.name || 'File'} is 0 bytes — nothing to download.`, 'neutral');
      return;
    }
    setBusyPath(entry.path);
    try {
      const isDump = /\.dmp$/i.test(entry.name);
      if (isDump) {
        const result = await ftpDownloadBinary({ ...ftpPayload, remotePath: entry.path });
        if (!result?.base64 || (result.size || 0) === 0) {
          throw new Error('Server returned an empty file.');
        }
        triggerDownload(base64ToBlob(result.base64), entry.name);
      } else {
        const result = await ftpDownload({ ...ftpPayload, remotePath: entry.path });
        triggerDownload(new Blob([result.content || ''], { type: 'text/plain' }), entry.name);
      }
      notify?.(`Downloaded ${entry.name}.`, 'success');
    } catch (err) {
      notify?.(err.message || `Failed to download ${entry.name}.`, 'error');
    } finally {
      setBusyPath(null);
    }
  }

  async function handleDownloadSelected() {
    const targets = entries.filter((entry) => selection.has(entry.path));
    if (!targets.length) {
      notify?.('Select one or more files first.', 'neutral');
      return;
    }
    for (const entry of targets) {
      // eslint-disable-next-line no-await-in-loop
      await handleDownloadOne(entry);
    }
  }

  function toggleSelect(path) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelection((prev) => {
      if (prev.size === entries.length) return new Set();
      return new Set(entries.map((entry) => entry.path));
    });
  }

  // For the "Report to WoR" flow we only need the single most recent dump and
  // the single most recent log. Entries arrive pre-sorted newest-first from the
  // backend, but re-sort defensively in case the user has triggered a rescan.
  // Skip zero-byte files — they carry no useful payload.
  const latestDump = useMemo(
    () => [...entries]
      .filter((e) => /\.dmp$/i.test(e.name) && (e.size || 0) > 0)
      .sort((a, b) => Date.parse(b.modifiedAt || 0) - Date.parse(a.modifiedAt || 0))[0] || null,
    [entries],
  );
  const latestLog = useMemo(
    () => [...entries]
      .filter((e) => /\.log$/i.test(e.name) && (e.size || 0) > 0)
      .sort((a, b) => Date.parse(b.modifiedAt || 0) - Date.parse(a.modifiedAt || 0))[0] || null,
    [entries],
  );
  const reportTargets = [latestDump, latestLog].filter(Boolean);
  const featuredEntries = useMemo(() => {
    const byPath = new Map();
    if (latestDump) byPath.set(latestDump.path, latestDump);
    if (latestLog) byPath.set(latestLog.path, latestLog);
    return [...byPath.values()].sort((a, b) => Date.parse(b.modifiedAt || 0) - Date.parse(a.modifiedAt || 0));
  }, [latestDump, latestLog]);
  const featuredPaths = useMemo(() => new Set(featuredEntries.map((entry) => entry.path)), [featuredEntries]);
  const remainingEntries = useMemo(
    () => entries.filter((entry) => !featuredPaths.has(entry.path)),
    [entries, featuredPaths],
  );

  if (!ftpReady) {
    return (
      <FtpAuthPrompt
        title="Connect to export crash dumps"
        description="Crash dumps are stored on the server under /Diagnostics. Connect via FTP to list, download, and report them."
        icon="crashes"
        onConnect={onRequestConnect}
      />
    );
  }

  const allSelected = entries.length > 0 && selection.size === entries.length;
  const selectedCount = selection.size;
  const totalSize = entries.reduce((sum, entry) => sum + (entry.size || 0), 0);

  return (
    <section className="workspace-card card-shell crash-view">
      <div className="panel-header panel-header--tight panel-header--crashes">
        <div>
          <p className="eyebrow">Crash diagnostics</p>
          <h2>Crash dumps &amp; diagnostic logs</h2>
        </div>
        <div className="button-row button-row--compact panel-header__actions">
          <button type="button" className="icon-btn panel-header__action-btn" onClick={() => refresh({ repopulate: true })} disabled={loading}>
            <IconRefresh className={loading ? 'spin' : ''} />
            <span>Rescan</span>
          </button>
          <button
            type="button"
            className="icon-btn panel-header__action-btn panel-header__action-btn--primary"
            onClick={() => setShowReportModal(true)}
            disabled={entries.length === 0}
          >
            <span>Report to WoR</span>
          </button>
        </div>
      </div>

      <p className="crash-view__copy">
        Scanning <code>{CRASH_DIR}</code> recursively for <code>.dmp</code> and <code>.log</code> files, plus the latest <code>server*.log</code> from <code>/</code>.
        {entries.length > 0 && (
          <>
            {' '}Found <strong>{entries.length}</strong> file{entries.length === 1 ? '' : 's'} ({formatBytes(totalSize)}).
          </>
        )}
      </p>

      {error ? <div className="logs-view__error logs-view__error--block">{error}</div> : null}

      {loading && !entries.length ? (
        <div className="logs-view__placeholder"><div className="sync-loader__ring" /><p>Scanning Diagnostics…</p></div>
      ) : null}

      {!loading && !entries.length && !error ? (
        <div className="crash-view__empty">
          <IconFile width="28" height="28" />
          <p>No crash dumps or diagnostic logs found. Your server is running clean.</p>
        </div>
      ) : null}

      {entries.length > 0 && (
        <div className="crash-view__toolbar">
          <label className="checkbox">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
            <span>{allSelected ? 'Unselect all' : 'Select all'}</span>
          </label>
          <span className="crash-view__toolbar-meta">
            {selectedCount > 0 ? `${selectedCount} selected` : 'Select files to export in bulk'}
          </span>
          <button
            type="button"
            className="button button--sm button--ghost"
            onClick={handleDownloadSelected}
            disabled={selectedCount === 0 || !!busyPath}
          >
            <IconDownload /> Download selected
          </button>
        </div>
      )}

      {featuredEntries.length > 0 && (
        <div className="crash-list-section">
          <div className="crash-list-section__header">
            <span className="crash-list-section__title">Latest files</span>
            <span className="crash-list-section__meta">Used by Report to WoR</span>
          </div>
          <ul className="crash-list crash-list--featured">
            {featuredEntries.map((entry) => {
              const isDump = /\.dmp$/i.test(entry.name);
              const isSelected = selection.has(entry.path);
              const isBusy = busyPath === entry.path;
              return (
                <li key={entry.path} className={`crash-list__row crash-list__row--featured ${isSelected ? 'is-selected' : ''}`}>
                  <label className="checkbox crash-list__check">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(entry.path)}
                    />
                  </label>
                  <div className="crash-list__info">
                    <div className="crash-list__name-row">
                      <span className={`crash-list__tag ${isDump ? 'crash-list__tag--dump' : 'crash-list__tag--log'}`}>
                        {isDump ? 'DMP' : 'LOG'}
                      </span>
                      <span className="crash-list__name" title={entry.path}>{entry.name}</span>
                    </div>
                    <div className="crash-list__meta">
                      <span title={entry.path}>{entry.path}</span>
                      <span className="log-entry__dot">•</span>
                      <span>{formatBytes(entry.size)}</span>
                      <span className="log-entry__dot">•</span>
                      <span>{entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString() : '—'}</span>
                      <span className="crash-list__rel">({formatRelativeTime(entry.modifiedAt)})</span>
                    </div>
                  </div>
                  <div className="crash-list__actions">
                    <button
                      type="button"
                      className="button button--sm button--ghost"
                      onClick={() => handleDownloadOne(entry)}
                      disabled={isBusy}
                    >
                      <IconDownload /> {isBusy ? 'Downloading…' : 'Download'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {remainingEntries.length > 0 && (
        <div className="crash-list-section">
          <div className="crash-list-section__header">
            <span className="crash-list-section__title">All files</span>
            <span className="crash-list-section__meta">Older diagnostics and logs</span>
          </div>
          <ul className="crash-list">
            {remainingEntries.map((entry) => {
              const isDump = /\.dmp$/i.test(entry.name);
              const isSelected = selection.has(entry.path);
              const isBusy = busyPath === entry.path;
              return (
                <li key={entry.path} className={`crash-list__row ${isSelected ? 'is-selected' : ''}`}>
                  <label className="checkbox crash-list__check">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(entry.path)}
                    />
                  </label>
                  <div className="crash-list__info">
                    <div className="crash-list__name-row">
                      <span className={`crash-list__tag ${isDump ? 'crash-list__tag--dump' : 'crash-list__tag--log'}`}>
                        {isDump ? 'DMP' : 'LOG'}
                      </span>
                      <span className="crash-list__name" title={entry.path}>{entry.name}</span>
                    </div>
                    <div className="crash-list__meta">
                      <span title={entry.path}>{entry.path}</span>
                      <span className="log-entry__dot">•</span>
                      <span>{formatBytes(entry.size)}</span>
                      <span className="log-entry__dot">•</span>
                      <span>{entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString() : '—'}</span>
                      <span className="crash-list__rel">({formatRelativeTime(entry.modifiedAt)})</span>
                    </div>
                  </div>
                  <div className="crash-list__actions">
                    <button
                      type="button"
                      className="button button--sm button--ghost"
                      onClick={() => handleDownloadOne(entry)}
                      disabled={isBusy}
                    >
                      <IconDownload /> {isBusy ? 'Downloading…' : 'Download'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {showReportModal && (
        <CrashReportModal
          onClose={() => setShowReportModal(false)}
          targets={reportTargets}
          onDownload={async () => {
            setShowReportModal(false);
            for (const entry of reportTargets) {
              // eslint-disable-next-line no-await-in-loop
              await handleDownloadOne(entry);
            }
          }}
        />
      )}
    </section>
  );
}

function CrashReportModal({ onClose, onDownload, targets }) {
  const totalBytes = targets.reduce((sum, t) => sum + (t.size || 0), 0);
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card modal-card--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-card__header">
          <h3>Report crash to War of Rights</h3>
          <button type="button" className="modal-card__close" onClick={onClose} aria-label="Close">
            <IconX width="16" height="16" />
          </button>
        </div>
        <div className="modal-card__body">
          <p>Help the dev team diagnose your issue:</p>
          <ol className="crash-modal__steps">
            <li>
              Download the latest crash dump and server log ({targets.length} file{targets.length === 1 ? '' : 's'}, {formatBytes(totalBytes)} total).
            </li>
            <li>Open the official error reporter and upload the files you just downloaded.</li>
            <li>Include a short description of what was happening when the crash occurred.</li>
          </ol>
          {targets.length > 0 && (
            <ul className="crash-modal__files">
              {targets.map((t) => (
                <li key={t.path}>
                  <span className={`crash-list__tag ${/\.dmp$/i.test(t.name) ? 'crash-list__tag--dump' : 'crash-list__tag--log'}`}>
                    {/\.dmp$/i.test(t.name) ? 'DMP' : 'LOG'}
                  </span>
                  <span className="crash-modal__file-name" title={t.path}>{t.name}</span>
                  <span className="crash-modal__file-meta">{formatBytes(t.size)} · {t.modifiedAt ? new Date(t.modifiedAt).toLocaleString() : '—'}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="crash-modal__actions">
            <button type="button" className="button button--ghost" onClick={onDownload} disabled={targets.length === 0}>
              <IconDownload /> Download files
            </button>
            <a
              href={REPORT_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="button button--primary"
            >
              Open Error Reporter ↗
            </a>
          </div>
          <p className="crash-modal__note">
            Opens <code>{REPORT_URL}</code> in a new tab.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
