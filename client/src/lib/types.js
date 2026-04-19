export const FILE_TYPES = {
  PRIVILEGES: 'privileges',
  CFG: 'cfg',
};

export const DEFAULT_REMOTE_PATHS = {
  [FILE_TYPES.PRIVILEGES]: '/Assets/privileges.xml',
  [FILE_TYPES.CFG]: '/dedicated.cfg',
};

export function createBlankPrivilegesDocument() {
  return {
    fileType: FILE_TYPES.PRIVILEGES,
    groups: [
      {
        id: crypto.randomUUID(),
        comment: 'Default',
        entries: [
          {
            id: crypto.randomUUID(),
            steamId: '',
            name: '',
            showColors: true,
            avatar: null,
            valid: null,
            loading: false,
          },
        ],
      },
    ],
    cfgEntries: [],
  };
}

export function createBlankCfgDocument() {
  return {
    fileType: FILE_TYPES.CFG,
    groups: [],
    cfgEntries: [
      {
        id: crypto.randomUUID(),
        type: 'entry',
        key: '',
        value: '',
        duplicate: false,
      },
    ],
  };
}
