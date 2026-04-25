export const LOGS_MAX_AUTO_OPEN_BYTES = 25 * 1024 * 1024;

export const logsViewCache = {
  endpointKey: '',
  entries: [],
  totalMatched: 0,
  fetchedAt: null,
  selectedPath: null,
  logText: '',
  logPath: null,
  search: '',
  levelFilter: [],
  categoryFilter: [],
  yearFilter: 'recent',
  pageSize: 500,
};

export const crashViewCache = {
  endpointKey: '',
  entries: [],
  selectionPaths: [],
  fetchedAt: null,
};

export function buildFtpEndpointKey(ftp) {
  const host = ftp.host?.trim() || '';
  const username = ftp.username?.trim() || '';
  const port = ftp.port ? Number(ftp.port) : 21;
  return `${username}@${host}:${port}`;
}
