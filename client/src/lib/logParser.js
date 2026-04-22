// Parses raw War of Rights / CryEngine-style server log text into structured lines.
//
// WoR log format (observed in server(N).log):
//   <HH:MM:SS> <free text>                              -> info
//   <HH:MM:SS> [Warning] <text>                          -> warn
//   <HH:MM:SS> [Error] / [Assert] / [Critical] <text>    -> error
//   <HH:MM:SS> [Subsystem] <text>                        -> info, subsystem captured
//   <HH:MM:SS> [Warning] [Subsystem] <text>              -> warn, subsystem captured
//   Subsystems seen: OnlineCore, Online, ThreadConfigInfo, CGame::LoadActionMaps,
//                    Layer 1, Team, Global, Squad, All, Chat, Network, GameRules, etc.

const COLOR_CODE_RE = /\$[0-9]/g;
// Timestamp: <HH:MM:SS> or <HH:MM:SS.fff> (angle brackets are WoR's native format).
const TIME_ONLY_RE = /^\s*<(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)>\s*/;
// Fallback for other formats (rare): "[HH:MM:SS]" or full ISO-ish date.
const FULL_DATE_RE = /^\s*[<\[]?(\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)[>\]]?\s*/;
const BRACKET_TIME_RE = /^\s*\[(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)\]\s*/;
// Any [Tag] at the start of what's left after stripping the timestamp.
const BRACKET_TAG_RE = /^\[([^\]]{1,80})\]\s*/;

const LEVEL_TAGS = new Set(['warning', 'warn', 'error', 'err', 'assert', 'critical', 'fatal', 'debug', 'trace', 'info', 'notice']);
const LEVEL_TO_ENUM = {
  warning: 'warn',
  warn: 'warn',
  error: 'error',
  err: 'error',
  assert: 'error',
  critical: 'error',
  fatal: 'error',
  debug: 'debug',
  trace: 'debug',
  info: 'info',
  notice: 'info',
};

// Chat channel subsystems. A chat line looks like:
//   [Team] PlayerName: hello team
//   [Global] PlayerName: hi all
const CHAT_CHANNELS = new Set(['team', 'global', 'squad', 'all', 'chat', 'say', 'cmd', 'command']);

// Subsystems we confidently classify as network/online.
const NETWORK_SUBSYSTEMS = new Set([
  'online', 'onlinecore', 'onlinelobbymanager', 'onlinesession',
  'network', 'net', 'steam', 'rcon', 'lobby',
]);

export const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
  UNKNOWN: 'unknown',
};

export const LOG_CATEGORIES = [
  'Chat',
  'Network',
  'System',
  'Error',
  'General',
];

function stripColorCodes(text) {
  return text.replace(COLOR_CODE_RE, '');
}

/**
 * Category is a coarse routing lane. Level drives color; category drives filter chips.
 * Precedence: Chat > Error > Network > System > General.
 * We purposefully keep rules narrow so chat messages about "killing" don't get
 * mis-bucketed into combat/error lanes.
 */
function detectCategory({ message, subsystem, level }) {
  const s = (subsystem || '').toLowerCase();

  // Chat: a known channel subsystem followed by "Name: message".
  if (CHAT_CHANNELS.has(s) && /^[^\s:][^:]{0,60}:\s/.test(message)) return 'Chat';

  // Hard errors always win over heuristics.
  if (level === LOG_LEVELS.ERROR) return 'Error';

  // Network / online stack.
  if (NETWORK_SUBSYSTEMS.has(s)) return 'Network';
  if (s.startsWith('online') || s.startsWith('steam')) return 'Network';

  // System: pak loading, cvars, config, level/mission boot.
  if (/^\s*(opening pak file|loading config file|cvar|buildtime|using (?:engine|asset|project) |stream engine|physics initialization|movie ?system|console initialization|time initialization|initializing (?:animation|3d engine|ai|additional)|entity system|network initialization)/i.test(message)) {
    return 'System';
  }
  if (/^\s*(onsysspecchange|unregistered cvar|executing console command)/i.test(message)) return 'System';

  return 'General';
}

function parseLine(rawLine, lineNumber) {
  const cleaned = stripColorCodes(rawLine).replace(/\r$/, '');
  let working = cleaned;
  let timestamp = null;

  // 1. Timestamp (try WoR native first, then bracketed, then full ISO).
  const m1 = working.match(TIME_ONLY_RE);
  if (m1) {
    timestamp = m1[1];
    working = working.slice(m1[0].length);
  } else {
    const m2 = working.match(FULL_DATE_RE);
    if (m2) {
      timestamp = m2[1];
      working = working.slice(m2[0].length);
    } else {
      const m3 = working.match(BRACKET_TIME_RE);
      if (m3) {
        timestamp = m3[1];
        working = working.slice(m3[0].length);
      }
    }
  }

  // 2. Consume up to two leading [bracket] tokens. The first may be a level
  //    or a subsystem; the second (if present) is always a subsystem.
  let level = LOG_LEVELS.UNKNOWN;
  let subsystem = null;

  for (let i = 0; i < 2; i += 1) {
    const tagMatch = working.match(BRACKET_TAG_RE);
    if (!tagMatch) break;
    const tagRaw = tagMatch[1].trim();
    const tagLc = tagRaw.toLowerCase();

    if (LEVEL_TAGS.has(tagLc) && level === LOG_LEVELS.UNKNOWN) {
      level = LEVEL_TO_ENUM[tagLc] || LOG_LEVELS.UNKNOWN;
      working = working.slice(tagMatch[0].length);
      continue;
    }
    if (!subsystem) {
      subsystem = tagRaw;
      working = working.slice(tagMatch[0].length);
      continue;
    }
    break;
  }

  // CryEngine also emits "<SubsystemName>: ..." (angle brackets) as a secondary form.
  if (!subsystem) {
    const angle = working.match(/^<([A-Za-z][A-Za-z0-9_:.-]{1,60})>\s*:?\s*/);
    if (angle) {
      subsystem = angle[1];
      working = working.slice(angle[0].length);
    }
  }

  const message = working.trim();

  // A truncated final write (server killed mid-line) can leave a fragment like
  // "<18:" or "<18:52" with no closing bracket. Treat those as blank so they
  // don't pollute the view.
  const isTruncatedFragment = !timestamp && /^<\d{1,2}(?::\d{0,2}){0,2}\.?\d*>?$/.test(message);

  // Default level: if we have a message, assume info; blank lines stay unknown.
  if (level === LOG_LEVELS.UNKNOWN && message.length > 0) {
    level = LOG_LEVELS.INFO;
  }

  const category = detectCategory({ message, subsystem, level });
  const steamIdMatch = message.match(/\b(7656\d{13})\b/);

  return {
    lineNumber,
    raw: cleaned,
    timestamp,
    level,
    subsystem,
    category,
    message,
    steamId: steamIdMatch ? steamIdMatch[1] : null,
    isBlank: cleaned.trim().length === 0 || isTruncatedFragment,
  };
}

export function parseLog(text) {
  if (!text) return { lines: [], stats: emptyStats() };
  const rawLines = text.split(/\r?\n/);
  const lines = rawLines.map((line, idx) => parseLine(line, idx + 1));
  return { lines, stats: buildStats(lines) };
}

function emptyStats() {
  return {
    total: 0,
    byLevel: { error: 0, warn: 0, info: 0, debug: 0, unknown: 0 },
    byCategory: {},
  };
}

function buildStats(lines) {
  const stats = emptyStats();
  for (const line of lines) {
    if (line.isBlank) continue;
    stats.total += 1;
    stats.byLevel[line.level] = (stats.byLevel[line.level] || 0) + 1;
    stats.byCategory[line.category] = (stats.byCategory[line.category] || 0) + 1;
  }
  return stats;
}

export function filterLines(lines, { search = '', levels = null, categories = null } = {}) {
  const needle = search.trim().toLowerCase();
  return lines.filter((line) => {
    if (line.isBlank) return false;
    if (levels && levels.size && !levels.has(line.level)) return false;
    if (categories && categories.size && !categories.has(line.category)) return false;
    if (!needle) return true;
    if (line.raw.toLowerCase().includes(needle)) return true;
    return false;
  });
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 && i > 0 ? n.toFixed(2) : n < 100 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

export function formatRelativeTime(iso) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const diff = Date.now() - t;
  const abs = Math.abs(diff);
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (abs < min) return 'just now';
  if (abs < hr) return `${Math.round(abs / min)}m ago`;
  if (abs < day) return `${Math.round(abs / hr)}h ago`;
  if (abs < 7 * day) return `${Math.round(abs / day)}d ago`;
  return new Date(t).toLocaleDateString();
}

/**
 * Render a log-line timestamp as a full human-readable string.
 * When the line only has "HH:MM:SS", we anchor the date to the file's mtime.
 */
export function formatLineTimestamp(rawTs, fileIsoDate) {
  if (!rawTs) return '';
  // If it's already a full date ("2026-04-22 15:44:30"), just reformat.
  const fullMatch = /^\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(rawTs);
  if (fullMatch) {
    const t = Date.parse(rawTs.replace(' ', 'T'));
    if (Number.isFinite(t)) return new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' });
    return rawTs;
  }
  // Time-only ("15:44:30") — anchor to the file mtime's date if provided.
  if (fileIsoDate) {
    const anchor = new Date(fileIsoDate);
    if (Number.isFinite(anchor.getTime())) {
      const [hh = 0, mm = 0, ss = 0] = rawTs.split(':').map((p) => parseInt(p, 10) || 0);
      anchor.setHours(hh, mm, ss, 0);
      return anchor.toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' });
    }
  }
  return rawTs;
}

/** Extract the year from a log file's modifiedAt timestamp, or null. */
export function extractYear(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).getFullYear();
}
