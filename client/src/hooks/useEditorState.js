import { useEffect, useReducer } from 'react';
import {
  DEFAULT_REMOTE_PATHS,
  FILE_TYPES,
  createBlankCfgDocument,
  createBlankPrivilegesDocument,
} from '../lib/types';
import { findDuplicateCfgKeys, serializeDocument } from '../lib/parser';

const FTP_PROFILE_KEY = 'wor-editor:ftp-profile';
const FTP_PASSWORD_KEY = 'wor-editor:ftp-password';
const ACTIVE_FILE_TYPE_KEY = 'wor-editor:active-file-type';

function createDocumentState(fileType) {
  const document = fileType === FILE_TYPES.CFG
    ? createBlankCfgDocument()
    : createBlankPrivilegesDocument();

  return {
    rawInput: '',
    document,
    snapshot: serializeDocument(document),
    source: { kind: 'blank', remotePath: null },
    saveState: { savedAt: null, channel: null },
    validation: {
      invalidSteamIds: [],
      cfgDuplicates: [],
    },
  };
}

function readStoredProfile() {
  let profile = {};
  try {
    profile = JSON.parse(localStorage.getItem(FTP_PROFILE_KEY) || '{}');
  } catch {
    profile = {};
  }

  let password = '';
  try {
    password = sessionStorage.getItem(FTP_PASSWORD_KEY) || '';
  } catch {
    password = '';
  }

  return {
    host: profile.host || '',
    port: profile.port || '21',
    username: profile.username || '',
    password,
    remotePaths: {
      [FILE_TYPES.PRIVILEGES]: profile.remotePaths?.[FILE_TYPES.PRIVILEGES] || DEFAULT_REMOTE_PATHS[FILE_TYPES.PRIVILEGES],
      [FILE_TYPES.CFG]: profile.remotePaths?.[FILE_TYPES.CFG] || DEFAULT_REMOTE_PATHS[FILE_TYPES.CFG],
    },
  };
}

function buildInitialState() {
  let activeFileType = FILE_TYPES.PRIVILEGES;
  try {
    const stored = localStorage.getItem(ACTIVE_FILE_TYPE_KEY);
    if (stored === FILE_TYPES.CFG || stored === FILE_TYPES.PRIVILEGES) activeFileType = stored;
  } catch {
    activeFileType = FILE_TYPES.PRIVILEGES;
  }

  return {
    activeFileType,
    ftp: readStoredProfile(),
    documents: {
      [FILE_TYPES.PRIVILEGES]: createDocumentState(FILE_TYPES.PRIVILEGES),
      [FILE_TYPES.CFG]: createDocumentState(FILE_TYPES.CFG),
    },
  };
}

function withDocument(state, fileType, updater) {
  const next = structuredClone(state);
  updater(next.documents[fileType]);
  return next;
}

function findGroup(documentState, groupId) {
  return documentState.document.groups.find((group) => group.id === groupId);
}

function findCfgEntry(documentState, entryId) {
  for (const item of documentState.document.cfgEntries) {
    if (item.id === entryId) return item;
    if (item.type === 'group') {
      const nested = item.entries.find((entry) => entry.id === entryId);
      if (nested) return nested;
    }
  }
  return null;
}

function syncInvalidSteamIds(documentState) {
  documentState.validation.invalidSteamIds = documentState.document.groups
    .flatMap((group) => group.entries)
    .filter((entry) => entry.valid === false)
    .map((entry) => entry.id);
}

function syncCfgDuplicates(documentState) {
  applyCfgDuplicateFlags(documentState, findDuplicateCfgKeys(documentState.document.cfgEntries));
}

function applyCfgDuplicateFlags(documentState, duplicates) {
  const duplicateIds = new Set(duplicates.flatMap((entry) => entry.ids));
  for (const item of documentState.document.cfgEntries) {
    if (item.type === 'group') {
      for (const nested of item.entries) nested.duplicate = duplicateIds.has(nested.id);
    } else {
      item.duplicate = duplicateIds.has(item.id);
    }
  }
  documentState.validation.cfgDuplicates = duplicates;
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_ACTIVE_FILE_TYPE':
      return { ...state, activeFileType: action.fileType };
    case 'UPDATE_FTP_FIELD':
      return {
        ...state,
        ftp: {
          ...state.ftp,
          [action.field]: action.value,
        },
      };
    case 'UPDATE_FTP_REMOTE_PATH':
      return {
        ...state,
        ftp: {
          ...state.ftp,
          remotePaths: {
            ...state.ftp.remotePaths,
            [action.fileType]: action.value,
          },
        },
      };
    case 'SET_RAW_INPUT':
      return withDocument(state, action.fileType, (documentState) => {
        documentState.rawInput = action.value;
      });
    case 'RESET_DOCUMENT': {
      const next = structuredClone(state);
      next.activeFileType = action.fileType;
      next.documents[action.fileType] = createDocumentState(action.fileType);
      return next;
    }
    case 'LOAD_DOCUMENT': {
      const next = structuredClone(state);
      if (action.setActive !== false) next.activeFileType = action.fileType;
      next.documents[action.fileType] = {
        rawInput: action.rawInput,
        document: action.document,
        snapshot: action.snapshot,
        source: action.source,
        saveState: action.saveState,
        validation: {
          invalidSteamIds: [],
          cfgDuplicates: [],
        },
      };
      if (action.fileType === FILE_TYPES.CFG) syncCfgDuplicates(next.documents[action.fileType]);
      else syncInvalidSteamIds(next.documents[action.fileType]);
      return next;
    }
    case 'MARK_SAVED':
      return withDocument(state, action.fileType, (documentState) => {
        documentState.snapshot = action.snapshot;
        documentState.source = {
          kind: action.channel === 'ftp' ? 'ftp' : documentState.source.kind,
          remotePath: action.remotePath || documentState.source.remotePath,
        };
        documentState.saveState = {
          savedAt: action.savedAt,
          channel: action.channel,
        };
      });
    case 'UPDATE_GROUP_NAME':
      return withDocument(state, action.fileType, (documentState) => {
        const group = findGroup(documentState, action.groupId);
        if (group) group.comment = action.value;
      });
    case 'ADD_GROUP':
      return withDocument(state, action.fileType, (documentState) => {
        documentState.document.groups.push({
          id: crypto.randomUUID(),
          comment: 'New Group',
          entries: [],
        });
        syncInvalidSteamIds(documentState);
      });
    case 'REMOVE_GROUP':
      return withDocument(state, action.fileType, (documentState) => {
        documentState.document.groups = documentState.document.groups.filter((group) => group.id !== action.groupId);
        syncInvalidSteamIds(documentState);
      });
    case 'ADD_GROUP_ENTRY':
      return withDocument(state, action.fileType, (documentState) => {
        const group = findGroup(documentState, action.groupId);
        if (!group) return;
        group.entries.push({
          id: crypto.randomUUID(),
          steamId: '',
          name: '',
          showColors: true,
          avatar: null,
          valid: null,
          loading: false,
        });
        syncInvalidSteamIds(documentState);
      });
    case 'REMOVE_GROUP_ENTRY':
      return withDocument(state, action.fileType, (documentState) => {
        const group = findGroup(documentState, action.groupId);
        if (!group) return;
        group.entries = group.entries.filter((entry) => entry.id !== action.entryId);
        syncInvalidSteamIds(documentState);
      });
    case 'UPDATE_GROUP_ENTRY':
      return withDocument(state, action.fileType, (documentState) => {
        const group = findGroup(documentState, action.groupId);
        const entry = group?.entries.find((item) => item.id === action.entryId);
        if (entry) Object.assign(entry, action.patch);
        syncInvalidSteamIds(documentState);
      });
    case 'SET_INVALID_STEAM_IDS':
      return withDocument(state, action.fileType, (documentState) => {
        documentState.validation.invalidSteamIds = action.ids;
      });
    case 'ADD_CFG_LINE':
      return withDocument(state, action.fileType, (documentState) => {
        documentState.document.cfgEntries.push({
          id: crypto.randomUUID(),
          type: 'entry',
          key: '',
          value: '',
          duplicate: false,
        });
        syncCfgDuplicates(documentState);
      });
    case 'ADD_CFG_PRESET':
      return withDocument(state, action.fileType, (documentState) => {
        documentState.document.cfgEntries.push({
          id: crypto.randomUUID(),
          type: 'group',
          name: action.preset.name,
          entries: action.preset.entries.map((entry) => ({
            id: crypto.randomUUID(),
            key: entry.key,
            value: entry.value,
            duplicate: false,
          })),
        });
        syncCfgDuplicates(documentState);
      });
    case 'UPDATE_CFG_ENTRY':
      return withDocument(state, action.fileType, (documentState) => {
        const entry = findCfgEntry(documentState, action.entryId);
        if (entry) Object.assign(entry, action.patch);
        syncCfgDuplicates(documentState);
      });
    case 'UPDATE_CFG_GROUP_NAME':
      return withDocument(state, action.fileType, (documentState) => {
        const group = documentState.document.cfgEntries.find((item) => item.id === action.groupId && item.type === 'group');
        if (group) group.name = action.value;
        syncCfgDuplicates(documentState);
      });
    case 'REMOVE_CFG_ENTRY':
      return withDocument(state, action.fileType, (documentState) => {
        documentState.document.cfgEntries = documentState.document.cfgEntries
          .map((item) => {
            if (item.type !== 'group') return item;
            return {
              ...item,
              entries: item.entries.filter((entry) => entry.id !== action.entryId),
            };
          })
          .filter((item) => item.type !== 'entry' || item.id !== action.entryId);
        syncCfgDuplicates(documentState);
      });
    case 'REMOVE_CFG_GROUP':
      return withDocument(state, action.fileType, (documentState) => {
        documentState.document.cfgEntries = documentState.document.cfgEntries.filter((item) => item.id !== action.groupId);
        syncCfgDuplicates(documentState);
      });
    case 'SET_CFG_DUPLICATES':
      return withDocument(state, action.fileType, (documentState) => {
        applyCfgDuplicateFlags(documentState, action.duplicates);
      });
    case 'SET_CFG_VALUES':
      return withDocument(state, action.fileType, (documentState) => {
        const entries = documentState.document.cfgEntries;
        const removeSet = new Set((action.removes || []).map((k) => k.toLowerCase()));
        const sets = action.sets || {};

        // Remove keys (from top-level and groups)
        for (let i = entries.length - 1; i >= 0; i--) {
          const item = entries[i];
          if (item.type === 'group') {
            item.entries = item.entries.filter((e) => !removeSet.has(e.key.toLowerCase()));
          } else if (removeSet.has(item.key.toLowerCase())) {
            entries.splice(i, 1);
          }
        }

        // Set/update keys
        for (const [key, value] of Object.entries(sets)) {
          let found = false;
          for (const item of entries) {
            if (item.type === 'group') {
              const matches = item.entries.filter((e) => e.key.toLowerCase() === key.toLowerCase());
              if (matches.length) {
                matches.forEach((match) => {
                  match.value = value;
                });
                found = true;
              }
            } else if (item.key.toLowerCase() === key.toLowerCase()) {
              item.value = value;
              found = true;
            }
          }
          if (!found) {
            entries.push({ id: crypto.randomUUID(), type: 'entry', key, value, duplicate: false });
          }
        }

        syncCfgDuplicates(documentState);
      });
    default:
      return state;
  }
}

export function useEditorState() {
  const [state, dispatch] = useReducer(reducer, undefined, buildInitialState);

  useEffect(() => {
    try {
      localStorage.setItem(FTP_PROFILE_KEY, JSON.stringify({
        host: state.ftp.host,
        port: state.ftp.port,
        username: state.ftp.username,
        remotePaths: state.ftp.remotePaths,
      }));
      localStorage.setItem(ACTIVE_FILE_TYPE_KEY, state.activeFileType);
      if (state.ftp.password) sessionStorage.setItem(FTP_PASSWORD_KEY, state.ftp.password);
      else sessionStorage.removeItem(FTP_PASSWORD_KEY);
    } catch {
      // Ignore storage failures.
    }
  }, [state.activeFileType, state.ftp]);

  return { state, dispatch };
}
