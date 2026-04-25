import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ftpDelete, ftpDownload, ftpListLogs } from '../lib/api';
import {
  extractYear,
  filterLines,
  formatBytes,
  formatLineTimestamp,
  formatRelativeTime,
  LOG_CATEGORIES,
  LOG_LEVELS,
  parseLog,
} from '../lib/logParser';
import { buildFtpEndpointKey, LOGS_MAX_AUTO_OPEN_BYTES, logsViewCache } from '../lib/viewCache';
import { IconChevron, IconCrash, IconDownload, IconFile, IconLogs, IconRefresh, IconTrash, IconX } from './Icons';

const DEFAULT_LIMIT = 10;
const INITIAL_PAGE_SIZE = 500;
const PAGE_STEP = 1000;

const LEVEL_META = {
  [LOG_LEVELS.ERROR]: { label: 'Error', className: 'log-level--error' },
  [LOG_LEVELS.WARN]: { label: 'Warn', className: 'log-level--warn' },
  [LOG_LEVELS.INFO]: { label: 'Info', className: 'log-level--info' },
  [LOG_LEVELS.DEBUG]: { label: 'Debug', className: 'log-level--debug' },
  [LOG_LEVELS.UNKNOWN]: { label: '•', className: 'log-level--unknown' },
};

function triggerBlobDownload(text, filename) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function LogsViewer({
  ftp,
  ftpReady,
  onRequestConnect,
  confirm,
  notify,
  refreshToken = 0,
  onRefreshed,
  shortcutCommand,
}) {
  const endpointKey = buildFtpEndpointKey(ftp);
  const canUseCache = logsViewCache.endpointKey === endpointKey;
  const cachedEntries = canUseCache ? logsViewCache.entries : [];

  const [entries, setEntries] = useState(() => cachedEntries);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [selected, setSelected] = useState(() => {
    if (!cachedEntries.length) return null;
    return cachedEntries.find((entry) => entry.path === logsViewCache.selectedPath) || cachedEntries[0] || null;
  });
  const [logText, setLogText] = useState(() => (
    canUseCache && logsViewCache.logPath === logsViewCache.selectedPath
      ? logsViewCache.logText
      : ''
  ));
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState('');
  const [search, setSearch] = useState(() => (canUseCache ? logsViewCache.search : ''));
  const [levelFilter, setLevelFilter] = useState(() => new Set(canUseCache ? logsViewCache.levelFilter : []));
  const [categoryFilter, setCategoryFilter] = useState(() => new Set(canUseCache ? logsViewCache.categoryFilter : []));
  const [busyPath, setBusyPath] = useState(null);
  const [yearFilter, setYearFilter] = useState(() => (canUseCache ? logsViewCache.yearFilter : 'recent'));
  const [pageSize, setPageSize] = useState(() => (canUseCache ? logsViewCache.pageSize : INITIAL_PAGE_SIZE));
  const [totalMatched, setTotalMatched] = useState(() => (canUseCache ? logsViewCache.totalMatched : 0));
  const fetchTokenRef = useRef(0);
  const loadedLogPathRef = useRef(canUseCache ? logsViewCache.logPath : null);

  const ftpPayload = useMemo(() => ({
    host: ftp.host?.trim(),
    port: ftp.port ? Number(ftp.port) : 21,
    username: ftp.username?.trim(),
    password: ftp.password,
  }), [ftp.host, ftp.port, ftp.username, ftp.password]);

  const refreshList = useCallback(async (mode = 'recent', options = {}) => {
    const { repopulate = false } = options;
    if (!ftpReady) return;
    if (repopulate) {
      setEntries([]);
      setSelected(null);
      setLogText('');
      setLogError('');
      loadedLogPathRef.current = null;
    }
    setListLoading(true);
    setListError('');
    try {
      // Fast path: when showing the default "latest N", ask the server to cap
      // the response so it never has to MDTM-probe every log file.
      const body = mode === 'recent' ? { ...ftpPayload, limit: DEFAULT_LIMIT } : ftpPayload;
      const result = await ftpListLogs(body);
      const items = result.entries || [];
      const fetchedAt = new Date().toISOString();
      setEntries(items);
      setTotalMatched(Number(result.totalMatched) || items.length);
      setSelected((prev) => {
        if (prev && items.some((item) => item.path === prev.path)) {
          return items.find((item) => item.path === prev.path);
        }
        return items[0] || null;
      });
      logsViewCache.fetchedAt = fetchedAt;
      onRefreshed?.({ fetchedAt, count: items.length });
    } catch (err) {
      setListError(err.message || 'Failed to load log listing.');
    } finally {
      setListLoading(false);
    }
  }, [ftpPayload, ftpReady, onRefreshed]);

  useEffect(() => {
    if (!ftpReady) return;
    if (entries.length > 0) return;
    refreshList('recent');
  }, [ftpReady, entries.length, refreshList]);

  useEffect(() => {
    if (!ftpReady) return;
    if (!refreshToken) return;
    refreshList(yearFilter, { repopulate: true });
  }, [refreshToken]);

  useEffect(() => {
    if (!shortcutCommand) return;
    if (shortcutCommand === 'focus-search') {
      const input = document.querySelector('.logs-view__search input[type="search"]');
      if (input) input.focus();
      return;
    }
    if (shortcutCommand === 'load-more') {
      if (hasMore) setPageSize((n) => n + PAGE_STEP);
      return;
    }
    if (shortcutCommand === 'reparse') {
      setSearch('');
      setLevelFilter(new Set());
      setCategoryFilter(new Set());
      setPageSize(INITIAL_PAGE_SIZE);
    }
  }, [shortcutCommand]);

  useEffect(() => {
    if (!selected) {
      setLogText('');
      setLogError('');
      return;
    }
    if (selected.size > LOGS_MAX_AUTO_OPEN_BYTES) {
      setLogText('');
      setLogError(`This log is ${formatBytes(selected.size)} — too large to preview in the browser. Use “Download” to save it to your computer.`);
      loadedLogPathRef.current = null;
      return;
    }

    if (loadedLogPathRef.current === selected.path && logText) {
      setLogError('');
      return;
    }

    const token = ++fetchTokenRef.current;
    setLogLoading(true);
    setLogError('');
    setLogText('');
    setPageSize(INITIAL_PAGE_SIZE);
    ftpDownload({ ...ftpPayload, remotePath: selected.path })
      .then((result) => {
        if (fetchTokenRef.current !== token) return;
        const content = result.content || '';
        setLogText(content);
        loadedLogPathRef.current = selected.path;
      })
      .catch((err) => {
        if (fetchTokenRef.current !== token) return;
        setLogError(err.message || 'Failed to download log file.');
        loadedLogPathRef.current = null;
      })
      .finally(() => {
        if (fetchTokenRef.current !== token) return;
        setLogLoading(false);
      });
  }, [selected, ftpPayload, logText]);

  useEffect(() => {
    logsViewCache.endpointKey = endpointKey;
    logsViewCache.entries = entries;
    logsViewCache.totalMatched = totalMatched;
    logsViewCache.selectedPath = selected?.path || null;
    logsViewCache.logText = logText;
    logsViewCache.logPath = loadedLogPathRef.current;
    logsViewCache.search = search;
    logsViewCache.levelFilter = [...levelFilter];
    logsViewCache.categoryFilter = [...categoryFilter];
    logsViewCache.yearFilter = yearFilter;
    logsViewCache.pageSize = pageSize;
  }, [endpointKey, entries, totalMatched, selected, logText, search, levelFilter, categoryFilter, yearFilter, pageSize]);

  const years = useMemo(() => {
    const set = new Set();
    for (const entry of entries) {
      const y = extractYear(entry.modifiedAt);
      if (y) set.add(y);
    }
    return [...set].sort((a, b) => b - a);
  }, [entries]);

  const handleYearChange = useCallback((nextMode) => {
    setYearFilter(nextMode);
    // If we only have the capped "latest N" loaded and the user wants to see more,
    // fetch the full listing. Once we've loaded the full list, switching between
    // year filters is purely client-side.
    const haveFullList = entries.length >= totalMatched && totalMatched > 0;
    if (nextMode !== 'recent' && !haveFullList) {
      refreshList(nextMode);
    }
  }, [entries.length, totalMatched, refreshList]);

  const visibleEntries = useMemo(() => {
    if (yearFilter === 'all') return entries;
    if (yearFilter === 'recent') return entries.slice(0, DEFAULT_LIMIT);
    const y = Number(yearFilter);
    return entries.filter((entry) => extractYear(entry.modifiedAt) === y);
  }, [entries, yearFilter]);

  const parsed = useMemo(() => (logText ? parseLog(logText) : { lines: [], stats: null }), [logText]);

  const filteredLines = useMemo(() => filterLines(parsed.lines, {
    search,
    levels: levelFilter.size ? levelFilter : null,
    categories: categoryFilter.size ? categoryFilter : null,
  }), [parsed.lines, search, levelFilter, categoryFilter]);

  const orderedLines = useMemo(() => [...filteredLines].reverse(), [filteredLines]);
  const renderedLines = useMemo(() => orderedLines.slice(0, pageSize), [orderedLines, pageSize]);
  const hasMore = orderedLines.length > renderedLines.length;

  function toggleLevel(level) {
    setLevelFilter((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level); else next.add(level);
      return next;
    });
    setPageSize(INITIAL_PAGE_SIZE);
  }

  function toggleCategory(cat) {
    setCategoryFilter((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
    setPageSize(INITIAL_PAGE_SIZE);
  }

  function clearFilters() {
    setSearch('');
    setLevelFilter(new Set());
    setCategoryFilter(new Set());
    setPageSize(INITIAL_PAGE_SIZE);
  }

  async function handleDownload(entry) {
    setBusyPath(entry.path);
    try {
      const result = await ftpDownload({ ...ftpPayload, remotePath: entry.path });
      triggerBlobDownload(result.content || '', entry.name);
      notify?.(`Downloaded ${entry.name}.`, 'success');
    } catch (err) {
      notify?.(err.message || `Failed to download ${entry.name}.`, 'error');
    } finally {
      setBusyPath(null);
    }
  }

  async function handleDelete(entry) {
    const ok = await confirm?.(
      `Delete ${entry.name} from the server? This cannot be undone.`,
      { title: 'Delete log file', confirmLabel: 'Delete', cancelLabel: 'Cancel', tone: 'danger' },
    );
    if (!ok) return;
    setBusyPath(entry.path);
    try {
      await ftpDelete({ ...ftpPayload, remotePath: entry.path });
      notify?.(`Deleted ${entry.name}.`, 'success');
      setEntries((prev) => prev.filter((item) => item.path !== entry.path));
      setSelected((prev) => (prev?.path === entry.path ? null : prev));
    } catch (err) {
      notify?.(err.message || `Failed to delete ${entry.name}.`, 'error');
    } finally {
      setBusyPath(null);
    }
  }

  if (!ftpReady) {
    return (
      <FtpAuthPrompt
        title="Connect to view server logs"
        description="Server logs live on your FTP host. Connect with your G-Portal FTP credentials to browse, search, and manage them."
        icon="logs"
        onConnect={onRequestConnect}
      />
    );
  }

  return (
    <section className="workspace-card card-shell">
      <div className="panel-header panel-header--tight panel-header--logs">
        <div>
          <p className="eyebrow">Server logs</p>
          <h2>Server log viewer</h2>
        </div>
        <div className="button-row button-row--compact panel-header__actions">
          <LogYearSelect
            value={yearFilter}
            years={years}
            totalCount={totalMatched || entries.length}
            onChange={handleYearChange}
          />
          <button
            type="button"
            className="icon-btn panel-header__action-btn"
            onClick={() => refreshList(yearFilter, { repopulate: true })}
            disabled={listLoading}
          >
            <IconRefresh className={listLoading ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div className="logs-view">
        <aside className="logs-view__sidebar">
          <div className="logs-view__sidebar-head">
            <span>
              Showing {visibleEntries.length} of {totalMatched || entries.length} file{(totalMatched || entries.length) === 1 ? '' : 's'}
            </span>
          </div>
          {listError && <div className="logs-view__error">{listError}</div>}
          {listLoading && !entries.length ? (
            <div className="logs-view__empty">Scanning…</div>
          ) : null}
          {!listLoading && !visibleEntries.length && !listError ? (
            <div className="logs-view__empty">
              {entries.length
                ? 'No logs match this filter. Try a different year.'
                : <>No <code>server*.log</code> files found in the FTP root.</>}
            </div>
          ) : null}
          <ul className="logs-view__list">
            {visibleEntries.map((entry) => {
              const isActive = selected?.path === entry.path;
              const isBusy = busyPath === entry.path;
              return (
                <li key={entry.path} className={`log-entry ${isActive ? 'is-active' : ''}`}>
                  <button
                    type="button"
                    className="log-entry__main"
                    onClick={() => setSelected(entry)}
                    disabled={isBusy}
                  >
                    <span className="log-entry__name" title={entry.name}>{entry.name}</span>
                    <span className="log-entry__meta">
                      <span>{formatBytes(entry.size)}</span>
                      <span className="log-entry__dot">•</span>
                      <span>{formatRelativeTime(entry.modifiedAt)}</span>
                    </span>
                  </button>
                  <div className="log-entry__actions">
                    <button
                      type="button"
                      className="icon-button icon-button--sm"
                      onClick={() => handleDownload(entry)}
                      disabled={isBusy}
                      title={`Download ${entry.name}`}
                      aria-label={`Download ${entry.name}`}
                    >
                      <IconDownload />
                    </button>
                    <button
                      type="button"
                      className="icon-button icon-button--sm icon-button--danger"
                      onClick={() => handleDelete(entry)}
                      disabled={isBusy}
                      title={`Delete ${entry.name}`}
                      aria-label={`Delete ${entry.name}`}
                    >
                      <IconTrash />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="logs-view__main">
          {listLoading && !entries.length ? (
            <div className="logs-view__placeholder"><div className="sync-loader__ring" /><p>Refreshing logs…</p></div>
          ) : !selected ? (
            <div className="logs-view__placeholder">
              <IconFile width="28" height="28" />
              <p>Select a log file to view.</p>
            </div>
          ) : (
            <>
              <header className="logs-view__header">
                <div className="logs-view__title-block">
                  <h3 className="logs-view__title">{selected.name}</h3>
                  <div className="logs-view__subtitle">
                    <span>{formatBytes(selected.size)}</span>
                    <span className="log-entry__dot">•</span>
                    <span>Modified {selected.modifiedAt ? new Date(selected.modifiedAt).toLocaleString() : '—'}</span>
                    {parsed.stats ? (
                      <>
                        <span className="log-entry__dot">•</span>
                        <span>{parsed.stats.total.toLocaleString()} lines</span>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="logs-view__header-actions">
                  <button
                    type="button"
                    className="button button--sm button--ghost"
                    onClick={() => handleDownload(selected)}
                    disabled={busyPath === selected.path}
                  >
                    <IconDownload /> Download
                  </button>
                </div>
              </header>

              {(
                <div className="logs-view__controls">
                  <div className="logs-view__search">
                    <input
                      type="search"
                      placeholder="Search events, names, SteamIDs…"
                      value={search}
                      onChange={(e) => { setSearch(e.target.value); setPageSize(INITIAL_PAGE_SIZE); }}
                    />
                    {(search || levelFilter.size || categoryFilter.size) ? (
                      <button type="button" className="icon-button icon-button--sm" onClick={clearFilters} title="Clear filters" aria-label="Clear filters">
                        <IconX />
                      </button>
                    ) : null}
                  </div>
                  <div className="logs-view__filters">
                    {Object.entries(LEVEL_META).filter(([key]) => key !== LOG_LEVELS.UNKNOWN).map(([key, meta]) => {
                      const count = parsed.stats?.byLevel?.[key] || 0;
                      const active = levelFilter.has(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          className={`chip ${meta.className} ${active ? 'is-active' : ''}`}
                          onClick={() => toggleLevel(key)}
                          disabled={count === 0 && !active}
                        >
                          {meta.label}
                          <span className="chip__count">{count.toLocaleString()}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="logs-view__filters">
                    {LOG_CATEGORIES.map((cat) => {
                      const count = parsed.stats?.byCategory?.[cat] || 0;
                      const active = categoryFilter.has(cat);
                      if (count === 0 && !active) return null;
                      return (
                        <button
                          key={cat}
                          type="button"
                          className={`chip chip--category ${active ? 'is-active' : ''}`}
                          onClick={() => toggleCategory(cat)}
                        >
                          {cat}
                          <span className="chip__count">{count.toLocaleString()}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {logLoading ? (
                <div className="logs-view__placeholder"><div className="sync-loader__ring" /><p>Loading log…</p></div>
              ) : logError ? (
                <div className="logs-view__error logs-view__error--block">{logError}</div>
              ) : (
                <div className="logs-view__pretty">
                  <div className="logs-view__status">
                    <span>
                      {renderedLines.length.toLocaleString()} of {orderedLines.length.toLocaleString()} matching lines · newest first
                    </span>
                    <span className="logs-view__status-hint">Use search or filters to narrow results</span>
                  </div>
                  {renderedLines.length === 0 ? (
                    <div className="logs-view__placeholder"><p>No matching lines.</p></div>
                  ) : (
                    <>
                      <ol className="logs-view__lines">
                        {renderedLines.map((line) => (
                          <LogLineRow
                            key={line.lineNumber}
                            line={line}
                            fileDate={selected.modifiedAt}
                          />
                        ))}
                      </ol>
                      {hasMore && (
                        <div className="logs-view__loadmore">
                          <button
                            type="button"
                            className="button button--sm button--ghost"
                            onClick={() => setPageSize((n) => n + PAGE_STEP)}
                          >
                            Load {Math.min(PAGE_STEP, orderedLines.length - renderedLines.length).toLocaleString()} more
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function LogLineRow({ line, fileDate }) {
  const meta = LEVEL_META[line.level] || LEVEL_META[LOG_LEVELS.UNKNOWN];
  const fullTs = line.timestamp ? formatLineTimestamp(line.timestamp, fileDate) : '';
  const timePart = line.timestamp
    ? (/^\d{1,2}:\d{2}:\d{2}/.test(line.timestamp)
      ? line.timestamp.replace(/\.\d+$/, '')
      : line.timestamp.slice(-8))
    : '';
  const datePart = (() => {
    if (!fileDate) return '';
    const d = new Date(fileDate);
    if (!Number.isFinite(d.getTime())) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}-${dd}`;
  })();
  return (
    <li className={`log-line ${meta.className}`} title={fullTs}>
      <span className={`log-line__level ${meta.className}`}>{meta.label}</span>
      <span className="log-line__time">
        {timePart
          ? (
            <>
              {datePart ? <span className="log-line__date">{datePart}</span> : null}
              <span className="log-line__clock">{timePart}</span>
            </>
          )
          : <span className="log-line__time--muted">—</span>}
      </span>
      <span className="log-line__category">{line.category}</span>
      <span className="log-line__message">
        {line.subsystem ? <span className="log-line__subsystem">[{line.subsystem}]</span> : null}
        {line.message}
      </span>
    </li>
  );
}

function LogYearSelect({ value, years, totalCount, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const label = value === 'recent'
    ? `Latest ${DEFAULT_LIMIT}`
    : value === 'all'
      ? `All (${totalCount})`
      : `Year ${value}`;

  return (
    <div className="log-year-select" ref={ref}>
      <button
        type="button"
        className="icon-btn panel-header__action-btn log-year-select__trigger"
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{label}</span>
        <IconChevron className="toolbar-menu__caret" style={{ transform: open ? 'rotate(180deg)' : undefined }} />
      </button>
      {open && (
        <div className="log-year-select__menu" role="listbox">
          <button
            type="button"
            role="option"
            aria-selected={value === 'recent'}
            className={`log-year-select__option ${value === 'recent' ? 'is-active' : ''}`}
            onClick={() => { onChange('recent'); setOpen(false); }}
          >
            Latest {DEFAULT_LIMIT}
          </button>
          <button
            type="button"
            role="option"
            aria-selected={value === 'all'}
            className={`log-year-select__option ${value === 'all' ? 'is-active' : ''}`}
            onClick={() => { onChange('all'); setOpen(false); }}
          >
            All files ({totalCount})
          </button>
          {years.length > 0 && <div className="log-year-select__divider" />}
          {years.map((y) => (
            <button
              key={y}
              type="button"
              role="option"
              aria-selected={String(value) === String(y)}
              className={`log-year-select__option ${String(value) === String(y) ? 'is-active' : ''}`}
              onClick={() => { onChange(String(y)); setOpen(false); }}
            >
              Year {y}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function FtpAuthPrompt({ title, description, icon = 'logs', onConnect }) {
  const Icon = icon === 'crashes' ? IconCrash : IconLogs;
  return (
    <div className="card-shell ftp-gate">
      <div className={`ftp-gate__icon ftp-gate__icon--${icon}`} aria-hidden>
        <Icon width="32" height="32" />
      </div>
      <h2 className="ftp-gate__title">{title}</h2>
      <p className="ftp-gate__copy">{description}</p>
      <div className="button-row">
        <button type="button" className="button button--primary" onClick={onConnect}>
          Connect to FTP
        </button>
      </div>
      <p className="ftp-gate__hint">Fill in the FTP panel on the right, then hit Connect &amp; Load.</p>
    </div>
  );
}
