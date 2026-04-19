import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CfgEditor } from './components/CfgEditor';
import { ConfirmModal } from './components/ConfirmModal';
import { FtpCard } from './components/FtpCard';
import { PrivilegesEditor } from './components/PrivilegesEditor';
import { IconChevron, IconDownload, IconFile, IconPlus, IconRefresh, IconUpload, IconX } from './components/Icons';
import { useConfirm } from './hooks/useConfirm';
import { useEditorState } from './hooks/useEditorState';
import { ftpCheck, ftpDownload, ftpUpload, resolveSteamProfile, validateSteamIds } from './lib/api';
import { cfgPresets } from './lib/cfgPresets';
import { detectFileType, findDuplicateCfgKeys, parseDocument, serializeDocument } from './lib/parser';
import {
  DEFAULT_REMOTE_PATHS,
  FILE_TYPES,
  createBlankCfgDocument,
  createBlankPrivilegesDocument,
} from './lib/types';

const fileLabels = {
  [FILE_TYPES.PRIVILEGES]: 'privileges.xml',
  [FILE_TYPES.CFG]: 'dedicated.cfg',
};

const tabLabels = {
  [FILE_TYPES.PRIVILEGES]: 'Admin roster',
  [FILE_TYPES.CFG]: 'Configuration',
};

const blankSnapshots = {
  [FILE_TYPES.PRIVILEGES]: serializeDocument(createBlankPrivilegesDocument()),
  [FILE_TYPES.CFG]: serializeDocument(createBlankCfgDocument()),
};

function isSteamId(value) {
  return /^\d{17}$/.test((value || '').trim());
}

function looksLikeProfileUrl(value) {
  const trimmed = (value || '').trim();
  return /steamcommunity\.com|steam:\/\//i.test(trimmed) || /\/id\/|\/profiles\//i.test(trimmed);
}

function buildDownloadName(fileType) {
  return fileType === FILE_TYPES.CFG ? 'dedicated.cfg' : 'privileges.xml';
}

function getPrivilegesEntries(document) {
  return (document.groups || []).flatMap((group) => group.entries || []);
}

function normalizeCfgKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function getServerNameFromCfgEntries(cfgEntries) {
  const preferredKeys = new Set([
    'online.server.name',
    'server.name',
    'servername',
    'sv_hostname',
    'hostname',
  ]);

  const stack = [...(cfgEntries || [])];
  while (stack.length) {
    const item = stack.shift();
    if (!item) continue;

    if (item.type === 'group' && Array.isArray(item.entries)) {
      stack.push(...item.entries);
      continue;
    }

    const key = normalizeCfgKey(item.key);
    if (!preferredKeys.has(key)) continue;
    const name = String(item.value || '').trim();
    if (name) return name;
  }

  return '';
}

function DropdownMenu({ trigger, children }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="toolbar-menu" ref={menuRef}>
      {trigger({ open, toggle: () => setOpen((prev) => !prev) })}
      {open && (
        <div className="toolbar-menu__dropdown" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { state, dispatch } = useEditorState();
  const { confirm, confirmState, resolveConfirm } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [ftpSessionConnected, setFtpSessionConnected] = useState(false);
  const [connectLoadState, setConnectLoadState] = useState({
    active: false,
    message: '',
    completed: 0,
    total: 0,
  });
  const [status, setStatus] = useState({ tone: 'neutral', text: '' });
  const [visibleStatus, setVisibleStatus] = useState(null); // { tone, text, leaving }
  const [uploadConfirm, setUploadConfirm] = useState(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const latestStateRef = useRef(state);
  const validationTimersRef = useRef(new Map());
  const validationTokensRef = useRef(new Map());
  const ftpPreloadDoneRef = useRef(false);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => () => {
    validationTimersRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    validationTimersRef.current.clear();
    validationTokensRef.current.clear();
  }, []);

  const currentDocumentState = state.documents[state.activeFileType];
  const currentDocument = currentDocumentState.document;
  const serializedCurrent = useMemo(() => serializeDocument(currentDocument), [currentDocument]);
  const currentInvalidCount = state.activeFileType === FILE_TYPES.PRIVILEGES
    ? currentDocumentState.validation.invalidSteamIds.length
    : 0;
  const currentDuplicateCount = state.activeFileType === FILE_TYPES.CFG
    ? currentDocumentState.validation.cfgDuplicates.length
    : 0;
  const currentLoadingCount = state.activeFileType === FILE_TYPES.PRIVILEGES
    ? getPrivilegesEntries(currentDocument).filter((entry) => entry.loading).length
    : 0;
  const dirtyCount = useMemo(() => Object.entries(state.documents).reduce((count, [, documentState]) => {
    const currentSnapshot = serializeDocument(documentState.document);
    return count + (currentSnapshot !== documentState.snapshot ? 1 : 0);
  }, 0), [state.documents]);
  const isBlank = currentDocumentState.source.kind === 'blank'
    && serializedCurrent === blankSnapshots[state.activeFileType];
  const canExport = currentLoadingCount === 0 && currentInvalidCount === 0 && currentDuplicateCount === 0;
  const latestServerName = useMemo(() => {
    const cfgDoc = state.documents[FILE_TYPES.CFG]?.document;
    return getServerNameFromCfgEntries(cfgDoc?.cfgEntries || []);
  }, [state.documents]);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (dirtyCount === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirtyCount]);

  const statusTimerRef = useRef(null);
  const statusExitRef = useRef(null);

  // Animate status banner in/out
  useEffect(() => {
    if (status.text) {
      if (statusExitRef.current) clearTimeout(statusExitRef.current);
      setVisibleStatus({ tone: status.tone, text: status.text, leaving: false });
    } else if (visibleStatus && !visibleStatus.leaving) {
      setVisibleStatus((prev) => prev ? { ...prev, leaving: true } : null);
      statusExitRef.current = setTimeout(() => {
        setVisibleStatus(null);
        statusExitRef.current = null;
      }, 300);
    }
  }, [status.text]);

  // Animate confirm bar in/out
  useEffect(() => {
    if (uploadConfirm) {
      setConfirmVisible(true);
    }
  }, [uploadConfirm]);

  function notify(text, tone = 'neutral') {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setStatus({ tone, text });
    if (tone !== 'error') {
      statusTimerRef.current = setTimeout(() => {
        setStatus((s) => (s.text === text ? { tone: 'neutral', text: '' } : s));
        statusTimerRef.current = null;
      }, 5000);
    }
  }

  function dismissStatus() {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setStatus({ tone: 'neutral', text: '' });
  }

  function dismissConfirm() {
    setConfirmVisible(false);
    setTimeout(() => setUploadConfirm(null), 300);
  }

  function getFtpPayload(fileType) {
    return {
      host: state.ftp.host.trim(),
      port: state.ftp.port ? Number(state.ftp.port) : 21,
      username: state.ftp.username.trim(),
      password: state.ftp.password,
      remotePath: state.ftp.remotePaths[fileType] || DEFAULT_REMOTE_PATHS[fileType],
    };
  }

  function handleFtpFieldChange(field, value) {
    dispatch({ type: 'UPDATE_FTP_FIELD', field, value });
    setFtpSessionConnected(false);
  }

  function getLatestPrivilegesEntry(fileType, groupId, entryId) {
    const documentState = latestStateRef.current.documents[fileType];
    const group = documentState.document.groups.find((item) => item.id === groupId);
    return group?.entries.find((entry) => entry.id === entryId) || null;
  }

  async function validateLoadedPrivileges(fileType, groups) {
    const numericEntries = groups.flatMap((group) => group.entries
      .filter((entry) => isSteamId(entry.steamId))
      .map((entry) => ({ groupId: group.id, entry })));

    if (!numericEntries.length) return;

    numericEntries.forEach(({ groupId, entry }) => {
      dispatch({
        type: 'UPDATE_GROUP_ENTRY',
        fileType,
        groupId,
        entryId: entry.id,
        patch: { loading: true, valid: null },
      });
    });

    try {
      const ids = [...new Set(numericEntries.map(({ entry }) => entry.steamId.trim()))];
      const response = await validateSteamIds(ids);
      const resultMap = new Map((response.results || []).map((result) => [result.id, result]));

      numericEntries.forEach(({ groupId, entry }) => {
        const latestEntry = getLatestPrivilegesEntry(fileType, groupId, entry.id);
        const result = resultMap.get(entry.steamId.trim());
        const patch = {
          loading: false,
          valid: result ? !!result.valid : null,
          avatar: result?.avatar || latestEntry?.avatar || null,
        };
        if (!latestEntry?.name && result?.name) patch.name = result.name;
        dispatch({
          type: 'UPDATE_GROUP_ENTRY',
          fileType,
          groupId,
          entryId: entry.id,
          patch,
        });
      });
    } catch (error) {
      numericEntries.forEach(({ groupId, entry }) => {
        dispatch({
          type: 'UPDATE_GROUP_ENTRY',
          fileType,
          groupId,
          entryId: entry.id,
          patch: { loading: false, valid: null },
        });
      });
      notify(error.message || 'Steam validation failed. Entries were left unverified.', 'error');
    }
  }

  async function loadTextIntoDocument(text, preferredFileType, sourceKind, remotePath = null, options = {}) {
    const { setActive = true, notifyOnSuccess = true } = options;
    let targetFileType = preferredFileType;
    const detected = detectFileType(text);

    if (detected !== 'unknown' && detected !== preferredFileType) {
      const confirmed = await confirm(
        `This content looks like ${fileLabels[detected]}. Switch to that file type and load it?`,
        { title: 'File type mismatch', confirmLabel: 'Switch', cancelLabel: 'Keep current' },
      );
      if (!confirmed) return false;
      targetFileType = detected;
    }

    const document = parseDocument(text, targetFileType);
    const snapshot = serializeDocument(document);
    startTransition(() => {
      dispatch({
        type: 'LOAD_DOCUMENT',
        fileType: targetFileType,
        setActive,
        rawInput: text,
        document,
        snapshot,
        source: { kind: sourceKind, remotePath },
        saveState: { savedAt: new Date().toISOString(), channel: sourceKind === 'ftp' ? 'ftp-load' : sourceKind },
      });
    });

    if (targetFileType === FILE_TYPES.PRIVILEGES) {
      await validateLoadedPrivileges(targetFileType, document.groups);
    } else {
      dispatch({
        type: 'SET_CFG_DUPLICATES',
        fileType: targetFileType,
        duplicates: findDuplicateCfgKeys(document.cfgEntries),
      });
    }

    if (notifyOnSuccess) notify(`${fileLabels[targetFileType]} loaded from ${sourceKind}.`, 'success');
    return true;
  }

  async function runEntryValidation(fileType, groupId, entryId, rawValue) {
    const requestKey = `${fileType}:${entryId}`;
    const token = crypto.randomUUID();
    validationTokensRef.current.set(requestKey, token);
    dispatch({
      type: 'UPDATE_GROUP_ENTRY',
      fileType,
      groupId,
      entryId,
      patch: { loading: true, valid: null },
    });

    try {
      let steamId = rawValue.trim();
      let avatar = null;
      let suggestedName = '';

      if (looksLikeProfileUrl(steamId)) {
        const resolved = await resolveSteamProfile(steamId);
        if (validationTokensRef.current.get(requestKey) !== token) return;
        steamId = resolved.steamid64 || steamId;
        avatar = resolved.avatar || null;
        suggestedName = resolved.name || '';
      }

      if (!isSteamId(steamId)) {
        if (validationTokensRef.current.get(requestKey) !== token) return;
        dispatch({
          type: 'UPDATE_GROUP_ENTRY',
          fileType,
          groupId,
          entryId,
          patch: { steamId, loading: false, valid: false, avatar: null },
        });
        return;
      }

      const response = await validateSteamIds([steamId]);
      if (validationTokensRef.current.get(requestKey) !== token) return;

      const result = (response.results || [])[0];
      const latestEntry = getLatestPrivilegesEntry(fileType, groupId, entryId);
      const patch = {
        steamId,
        loading: false,
        valid: result ? !!result.valid : null,
        avatar: result?.avatar || avatar || null,
      };
      if (!latestEntry?.name && (result?.name || suggestedName)) patch.name = result?.name || suggestedName;

      dispatch({
        type: 'UPDATE_GROUP_ENTRY',
        fileType,
        groupId,
        entryId,
        patch,
      });
    } catch (error) {
      if (validationTokensRef.current.get(requestKey) !== token) return;
      dispatch({
        type: 'UPDATE_GROUP_ENTRY',
        fileType,
        groupId,
        entryId,
        patch: { loading: false, valid: null },
      });
      notify(error.message || 'Steam validation failed.', 'error');
    } finally {
      if (validationTokensRef.current.get(requestKey) === token) validationTokensRef.current.delete(requestKey);
    }
  }

  function handlePrivilegesEntryChange(groupId, entryId, patch) {
    dispatch({
      type: 'UPDATE_GROUP_ENTRY',
      fileType: FILE_TYPES.PRIVILEGES,
      groupId,
      entryId,
      patch,
    });

    if (!Object.prototype.hasOwnProperty.call(patch, 'steamId')) return;

    const requestKey = `${FILE_TYPES.PRIVILEGES}:${entryId}`;
    const nextValue = patch.steamId.trim();
    const existingTimer = validationTimersRef.current.get(requestKey);
    if (existingTimer) clearTimeout(existingTimer);
    validationTimersRef.current.delete(requestKey);
    validationTokensRef.current.delete(requestKey);

    if (!nextValue) {
      dispatch({
        type: 'UPDATE_GROUP_ENTRY',
        fileType: FILE_TYPES.PRIVILEGES,
        groupId,
        entryId,
        patch: { avatar: null, valid: null, loading: false },
      });
      return;
    }

    if (!looksLikeProfileUrl(nextValue) && !isSteamId(nextValue)) {
      dispatch({
        type: 'UPDATE_GROUP_ENTRY',
        fileType: FILE_TYPES.PRIVILEGES,
        groupId,
        entryId,
        patch: { avatar: null, valid: null, loading: false },
      });
      return;
    }

    const timeoutId = window.setTimeout(() => {
      validationTimersRef.current.delete(requestKey);
      runEntryValidation(FILE_TYPES.PRIVILEGES, groupId, entryId, nextValue);
    }, 500);
    validationTimersRef.current.set(requestKey, timeoutId);
  }

  function handleNewBlank() {
    const ft = state.activeFileType;
    const doc = ft === FILE_TYPES.CFG ? createBlankCfgDocument() : createBlankPrivilegesDocument();
    const snapshot = serializeDocument(doc);
    startTransition(() => {
      dispatch({
        type: 'LOAD_DOCUMENT',
        fileType: ft,
        rawInput: '',
        document: doc,
        snapshot,
        source: { kind: 'new', remotePath: null },
        saveState: { savedAt: null, channel: null },
      });
    });
    notify(`Started a blank ${fileLabels[ft]} draft.`, 'success');
  }

  async function handleTestFtp() {
    setBusy(true);
    try {
      const payload = getFtpPayload(state.activeFileType);
      const result = await ftpCheck(payload);
      if (result.exists) {
        const sizeLabel = result.size ? ` (${(result.size / 1024).toFixed(1)} KB)` : '';
        notify(`FTP ready. Remote file found at ${payload.remotePath}${sizeLabel}.`, 'success');
      } else {
        notify(`FTP connected, but ${payload.remotePath} was not found.`, 'neutral');
      }
    } catch (error) {
      notify(error.message || 'FTP connection test failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleLoadFromFtp(targetFileType = null, silent = false) {
    const ft = targetFileType || state.activeFileType;
    const docState = latestStateRef.current.documents[ft];
    const hasContent = docState.source.kind !== 'blank';
    const isDirtyDoc = serializeDocument(docState.document) !== docState.snapshot;
    if (!silent && (isDirtyDoc || hasContent)) {
      const message = isDirtyDoc
        ? `You have unsaved changes to ${fileLabels[ft]}. Replace your working copy with the server version?`
        : `Replace your working copy of ${fileLabels[ft]} with the server version?`;
      const confirmed = await confirm(message, {
        title: 'Replace working copy',
        confirmLabel: 'Replace',
        cancelLabel: 'Cancel',
      });
      if (!confirmed) return;
    }

    setBusy(true);
    try {
      const payload = getFtpPayload(ft);
      const result = await ftpDownload(payload);
      const loaded = await loadTextIntoDocument(result.content || '', ft, 'ftp', payload.remotePath, {
        setActive: !silent,
        notifyOnSuccess: !silent,
      });
      if (loaded) setFtpSessionConnected(true);
    } catch (error) {
      if (!silent) notify(error.message || 'FTP download failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleFtpPreloadBoth() {
    if (ftpPreloadDoneRef.current) return;
    if (!state.ftp.host || !state.ftp.username || !state.ftp.password) return;
    ftpPreloadDoneRef.current = true;
    for (const ft of Object.values(FILE_TYPES)) {
      const docState = latestStateRef.current.documents[ft];
      if (docState.source.kind === 'blank') {
        await handleLoadFromFtp(ft, true);
      }
    }
  }

  async function handleConnectAndLoadAll() {
    const initialActiveFileType = latestStateRef.current.activeFileType;
    const preferredOrder = [FILE_TYPES.CFG, FILE_TYPES.PRIVILEGES];
    const targets = [];

    for (const ft of preferredOrder) {
      const docState = latestStateRef.current.documents[ft];
      const hasContent = docState.source.kind !== 'blank';
      const isDirtyDoc = serializeDocument(docState.document) !== docState.snapshot;
      if (isDirtyDoc || hasContent) {
        const message = isDirtyDoc
          ? `You have unsaved changes to ${fileLabels[ft]}. Replace with the server version?`
          : `Replace your working copy of ${fileLabels[ft]} with the server version?`;
        const confirmed = await confirm(message, {
          title: 'Replace working copy',
          confirmLabel: 'Replace',
          cancelLabel: 'Skip',
        });
        if (!confirmed) continue;
      }
      targets.push(ft);
    }

    if (!targets.length) {
      notify('No files were selected for loading.', 'neutral');
      return false;
    }

    setBusy(true);
    setConnectLoadState({
      active: true,
      message: 'Downloading server files…',
      completed: 0,
      total: targets.length,
    });

    try {
      let completed = 0;
      const settled = await Promise.allSettled(targets.map(async (ft) => {
        const payload = getFtpPayload(ft);
        const result = await ftpDownload(payload);
        return { fileType: ft, content: result.content || '', remotePath: payload.remotePath };
      }));

      completed = targets.length;
      setConnectLoadState((prev) => ({
        ...prev,
        message: 'Applying files…',
        completed,
      }));

      const successes = [];
      const failures = [];
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') successes.push(result.value);
        else failures.push({ fileType: targets[index], reason: result.reason });
      });

      const orderedSuccesses = [...successes].sort((a, b) => {
        if (a.fileType === b.fileType) return 0;
        if (a.fileType === FILE_TYPES.CFG) return -1;
        if (b.fileType === FILE_TYPES.CFG) return 1;
        return 0;
      });

      for (const loaded of orderedSuccesses) {
        await loadTextIntoDocument(loaded.content, loaded.fileType, 'ftp', loaded.remotePath, {
          setActive: false,
          notifyOnSuccess: false,
        });
      }

      dispatch({ type: 'SET_ACTIVE_FILE_TYPE', fileType: initialActiveFileType });
      ftpPreloadDoneRef.current = true;
      if (orderedSuccesses.length > 0) setFtpSessionConnected(true);

      failures.forEach(({ fileType, reason }) => {
        notify((reason && reason.message) || `FTP download of ${fileLabels[fileType]} failed.`, 'error');
      });

      if (orderedSuccesses.length > 0) {
        notify(`Loaded ${orderedSuccesses.map(({ fileType }) => fileLabels[fileType]).join(' and ')}.`, 'success');
      }
      return orderedSuccesses.length > 0;
    } catch (error) {
      notify(error.message || 'FTP load failed.', 'error');
      return false;
    } finally {
      setBusy(false);
      setConnectLoadState({ active: false, message: '', completed: 0, total: 0 });
    }
  }

  function handleUploadToFtp() {
    // Find all dirty file types
    const dirtyFileTypes = Object.entries(state.documents)
      .filter(([, docState]) => {
        const current = serializeDocument(docState.document);
        return current !== docState.snapshot && docState.source.kind !== 'blank';
      })
      .map(([ft]) => ft);

    if (dirtyFileTypes.length === 0) {
      notify('No changes to upload.', 'neutral');
      return;
    }

    // Check validation for all dirty files
    for (const ft of dirtyFileTypes) {
      const docState = state.documents[ft];
      if (ft === FILE_TYPES.PRIVILEGES) {
        const loadingCount = getPrivilegesEntries(docState.document).filter((e) => e.loading).length;
        if (docState.validation.invalidSteamIds.length > 0 || loadingCount > 0) {
          notify(`Resolve validation issues in ${fileLabels[ft]} before uploading.`, 'error');
          return;
        }
      }
      if (ft === FILE_TYPES.CFG && docState.validation.cfgDuplicates.length > 0) {
        notify(`Resolve duplicate keys in ${fileLabels[ft]} before uploading.`, 'error');
        return;
      }
    }

    // Show confirmation for each file individually
    setUploadConfirm({ fileTypes: dirtyFileTypes, index: 0, uploaded: [] });
  }

  async function executeUploadSingle(fileType) {
    setBusy(true);
    try {
      const payload = getFtpPayload(fileType);
      const content = serializeDocument(state.documents[fileType].document);
      await ftpUpload({ ...payload, content });
      dispatch({
        type: 'MARK_SAVED',
        fileType,
        snapshot: content,
        channel: 'ftp',
        remotePath: payload.remotePath,
        savedAt: new Date().toISOString(),
      });
      return true;
    } catch (error) {
      notify(error.message || `Failed to upload ${fileLabels[fileType]}.`, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmUpload() {
    const { fileTypes, index, uploaded } = uploadConfirm;
    const ft = fileTypes[index];
    const ok = await executeUploadSingle(ft);
    const nextUploaded = ok ? [...uploaded, fileLabels[ft]] : uploaded;
    finishOrAdvance(fileTypes, index + 1, nextUploaded);
  }

  function handleSkipUpload() {
    const { fileTypes, index, uploaded } = uploadConfirm;
    finishOrAdvance(fileTypes, index + 1, uploaded);
  }

  function finishOrAdvance(fileTypes, nextIndex, uploaded) {
    if (nextIndex < fileTypes.length) {
      setUploadConfirm({ fileTypes, index: nextIndex, uploaded });
    } else {
      dismissConfirm();
      if (uploaded.length > 0) {
        notify(`Published ${uploaded.join(' & ')} to server. Restart/apply changes in your G-Portal panel.`, 'success');
      } else {
        notify('No files were published.', 'neutral');
      }
    }
  }

  function handleDownloadExport() {
    const blob = new Blob([
      serializedCurrent,
    ], { type: state.activeFileType === FILE_TYPES.CFG ? 'text/plain' : 'application/xml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = buildDownloadName(state.activeFileType);
    anchor.click();
    URL.revokeObjectURL(url);
    notify(`Downloaded ${buildDownloadName(state.activeFileType)}.`, 'success');
  }

  const ftpConnectedFromDocs = Object.values(state.documents).some(
    (ds) => ds.source.kind === 'ftp',
  );
  const ftpConnected = ftpSessionConnected || ftpConnectedFromDocs;
  const canSync = !busy && !!state.ftp.host && !!state.ftp.username && !!state.ftp.password;

  const isDirty = serializedCurrent !== currentDocumentState.snapshot;
  const bannerToneClass = visibleStatus
    ? visibleStatus.tone === 'success'
      ? 'banner--success'
      : visibleStatus.tone === 'error'
        ? 'banner--danger'
        : 'banner--neutral'
    : 'banner--neutral';

  return (
    <div className="app-shell">
      <header className="hero-bar">
        <div className="hero-bar__brand">
          <span className="hero-bar__mark">W</span>
          <div className="hero-bar__text">
            <span className="hero-bar__accent">Server Configurator</span>
            <span className="hero-bar__title">WoR Server Helper</span>
          </div>
        </div>
        <span className="hero-bar__sub">Gportal alternative for roster and configuration editing</span>
      </header>

      <div className="toolbar">
        <div className="tab-switcher">
          {Object.values(FILE_TYPES).map((fileType) => (
            <button
              key={fileType}
              type="button"
              className={`tab-switcher__button ${state.activeFileType === fileType ? 'is-active' : ''}`}
              onClick={() => {
                dispatch({ type: 'SET_ACTIVE_FILE_TYPE', fileType });
                const docState = latestStateRef.current.documents[fileType];
                if (docState.source.kind === 'blank' && state.ftp.host && state.ftp.username && state.ftp.password) {
                  handleLoadFromFtp(fileType, true);
                }
              }}
            >
              {tabLabels[fileType]}
            </button>
          ))}
        </div>

        <div className="toolbar__actions">
          {isDirty && <span className="toolbar__dirty-badge">Unsaved changes</span>}
          {currentInvalidCount > 0 && <span className="toolbar__badge toolbar__badge--danger">{currentInvalidCount} invalid</span>}
          {currentDuplicateCount > 0 && <span className="toolbar__badge toolbar__badge--warn">{currentDuplicateCount} duplicate{currentDuplicateCount > 1 ? 's' : ''}</span>}

          <DropdownMenu trigger={({ open, toggle }) => (
            <button
              type="button"
              className="toolbar-menu__trigger toolbar-menu__trigger--primary"
              onClick={toggle}
              aria-haspopup="true"
              aria-expanded={open}
            >
              <IconUpload /> Server
              <IconChevron className="toolbar-menu__caret" style={{ transform: open ? 'rotate(180deg)' : undefined }} />
            </button>
          )}>
            <button type="button" className="toolbar-menu__item" onClick={handleUploadToFtp} disabled={busy || !canSync || !isDirty}>
              <IconUpload /> Publish changes
            </button>
            <button type="button" className="toolbar-menu__item" onClick={() => handleLoadFromFtp()} disabled={!canSync}>
              <IconRefresh /> Sync from server
            </button>
          </DropdownMenu>

          <DropdownMenu trigger={({ open, toggle }) => (
            <button
              type="button"
              className="toolbar-menu__trigger toolbar-menu__trigger--ghost"
              onClick={toggle}
              aria-haspopup="true"
              aria-expanded={open}
            >
              <IconFile /> File
              <IconChevron className="toolbar-menu__caret" style={{ transform: open ? 'rotate(180deg)' : undefined }} />
            </button>
          )}>
            <button type="button" className="toolbar-menu__item" onClick={handleNewBlank}>
              <IconPlus /> New document
            </button>
            <button type="button" className="toolbar-menu__item" disabled={!canExport} onClick={handleDownloadExport}>
              <IconDownload /> Save to computer
            </button>
          </DropdownMenu>
        </div>
      </div>

      {visibleStatus && (
        <div className={`info-banner ${bannerToneClass} ${visibleStatus.leaving ? 'info-banner--leaving' : 'info-banner--entering'}`}>
          <span>{visibleStatus.text}</span>
          <button type="button" className="info-banner__dismiss" onClick={dismissStatus} aria-label="Dismiss">
            <IconX width="14" height="14" />
          </button>
        </div>
      )}

      {uploadConfirm && (
        <div className={`confirm-bar ${confirmVisible ? 'confirm-bar--entering' : 'confirm-bar--leaving'}`}>
          <span>Overwrite <strong>{fileLabels[uploadConfirm.fileTypes[uploadConfirm.index]]}</strong> on the server?{uploadConfirm.fileTypes.length > 1 && ` (${uploadConfirm.index + 1}/${uploadConfirm.fileTypes.length})`}</span>
          <div className="confirm-bar__actions">
            <button type="button" className="button button--sm button--ghost" onClick={dismissConfirm}>Cancel</button>
            {uploadConfirm.fileTypes.length > 1 && (
              <button type="button" className="button button--sm button--ghost" onClick={handleSkipUpload}>Skip</button>
            )}
            <button type="button" className="button button--sm button--danger" onClick={handleConfirmUpload}>Overwrite</button>
          </div>
        </div>
      )}

      <main className="workspace-grid">
        <div className="workspace-main">
          {connectLoadState.active ? (
            <div className="card-shell sync-loader" role="status" aria-live="polite">
              <div className="sync-loader__ring" />
              <p className="eyebrow">Server sync</p>
              <h2 className="sync-loader__title">Loading server files</h2>
              <p className="sync-loader__copy">{connectLoadState.message}</p>
              <p className="sync-loader__progress">{connectLoadState.completed}/{connectLoadState.total} complete</p>
            </div>
          ) : isBlank ? (
            <div className="card-shell empty-state">
              <div className="empty-state__inner">
                <h2 className="empty-state__title">No data loaded</h2>
                <p className="empty-state__copy">Connect to FTP and download your server files, or start with a blank document.</p>
                <div className="button-row">
                  <button type="button" className="button button--primary" onClick={handleNewBlank}>
                    <IconPlus /> Start blank {fileLabels[state.activeFileType]}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {!isBlank && state.activeFileType === FILE_TYPES.PRIVILEGES ? (
            <PrivilegesEditor
              groups={currentDocument.groups}
              onAddGroup={() => dispatch({ type: 'ADD_GROUP', fileType: FILE_TYPES.PRIVILEGES })}
              onRemoveGroup={(groupId) => dispatch({ type: 'REMOVE_GROUP', fileType: FILE_TYPES.PRIVILEGES, groupId })}
              onGroupNameChange={(groupId, value) => dispatch({ type: 'UPDATE_GROUP_NAME', fileType: FILE_TYPES.PRIVILEGES, groupId, value })}
              onAddEntry={(groupId) => dispatch({ type: 'ADD_GROUP_ENTRY', fileType: FILE_TYPES.PRIVILEGES, groupId })}
              onRemoveEntry={(groupId, entryId) => dispatch({ type: 'REMOVE_GROUP_ENTRY', fileType: FILE_TYPES.PRIVILEGES, groupId, entryId })}
              onEntryChange={handlePrivilegesEntryChange}
            />
          ) : null}

          {!isBlank && state.activeFileType === FILE_TYPES.CFG ? (
            <CfgEditor
              entries={currentDocument.cfgEntries}
              presets={cfgPresets}
              duplicateCount={currentDuplicateCount}
              onSetValues={(sets, removes) => dispatch({ type: 'SET_CFG_VALUES', fileType: FILE_TYPES.CFG, sets, removes })}
              onAddLine={() => dispatch({ type: 'ADD_CFG_LINE', fileType: FILE_TYPES.CFG })}
              onAddPreset={(preset) => dispatch({ type: 'ADD_CFG_PRESET', fileType: FILE_TYPES.CFG, preset })}
              onRemoveGroup={(groupId) => dispatch({ type: 'REMOVE_CFG_GROUP', fileType: FILE_TYPES.CFG, groupId })}
              onRemoveEntry={(entryId) => dispatch({ type: 'REMOVE_CFG_ENTRY', fileType: FILE_TYPES.CFG, entryId })}
              onUpdateEntry={(entryId, patch) => dispatch({ type: 'UPDATE_CFG_ENTRY', fileType: FILE_TYPES.CFG, entryId, patch })}
              onUpdateGroupName={(groupId, value) => dispatch({ type: 'UPDATE_CFG_GROUP_NAME', fileType: FILE_TYPES.CFG, groupId, value })}
            />
          ) : null}
        </div>

        <FtpCard
          ftp={state.ftp}
          serverLabel={latestServerName}
          busy={busy}
          connectLoading={connectLoadState.active}
          connectMessage={connectLoadState.message}
          connectProgress={connectLoadState.completed}
          connectTotal={connectLoadState.total}
          connected={ftpConnected}
          dirtyCount={dirtyCount}
          canSync={canSync}
          saveState={currentDocumentState.saveState}
          onFieldChange={handleFtpFieldChange}
          onSaveProfile={() => notify('FTP profile saved.', 'success')}
          onTest={handleTestFtp}
          onConnect={handleConnectAndLoadAll}
          onSync={() => handleLoadFromFtp()}
          onPublish={handleUploadToFtp}
          onLoadProfile={(profile) => {
            setFtpSessionConnected(false);
            dispatch({ type: 'UPDATE_FTP_FIELD', field: 'host', value: profile.host });
            dispatch({ type: 'UPDATE_FTP_FIELD', field: 'port', value: profile.port || '21' });
            dispatch({ type: 'UPDATE_FTP_FIELD', field: 'username', value: profile.username });
            if (profile.remotePaths) {
              Object.entries(profile.remotePaths).forEach(([ft, path]) => {
                dispatch({ type: 'UPDATE_FTP_REMOTE_PATH', fileType: ft, value: path });
              });
            }
            notify(`Loaded profile: ${profile.name}`, 'success');
          }}
        />
      </main>
      <ConfirmModal state={confirmState} onResolve={resolveConfirm} />
    </div>
  );
}
