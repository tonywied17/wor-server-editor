import { FILE_TYPES } from './types';

export function detectFileType(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return 'unknown';
  if (/\?xml/i.test(trimmed) || /<SteamIDs\b/i.test(trimmed) || /<SteamID\b/i.test(trimmed)) {
    return FILE_TYPES.PRIVILEGES;
  }

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let keyValueLines = 0;
  let xmlLines = 0;
  for (const line of lines.slice(0, 40)) {
    if (line.includes('=')) keyValueLines += 1;
    if (line.startsWith('<')) xmlLines += 1;
  }
  if (keyValueLines > 0 && xmlLines === 0) return FILE_TYPES.CFG;
  if (xmlLines > 0 && keyValueLines === 0) return FILE_TYPES.PRIVILEGES;
  return 'unknown';
}

function stripInlineComments(xmlText) {
  const lines = (xmlText || '').split(/\r?\n/);
  const commentPattern = /<!--([\s\S]*?)-->/g;
  return lines
    .map((line) => {
      if (!commentPattern.test(line)) return line;
      commentPattern.lastIndex = 0;
      const withoutComments = line.replace(commentPattern, '');
      return withoutComments.trim().length > 0 ? withoutComments : line;
    })
    .join('\n');
}

export function parsePrivilegesXml(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(stripInlineComments(xmlText), 'application/xml');
  const steamIDsNode = doc.querySelector('SteamIDs');
  if (!steamIDsNode) {
    return [
      {
        id: crypto.randomUUID(),
        comment: 'Default',
        entries: [],
      },
    ];
  }

  const groups = [];
  let current = {
    id: crypto.randomUUID(),
    comment: 'Default',
    entries: [],
  };

  for (const node of steamIDsNode.childNodes) {
    if (node.nodeType === Node.COMMENT_NODE) {
      if (current.entries.length || current.comment !== 'Default') groups.push(current);
      current = {
        id: crypto.randomUUID(),
        comment: node.data.trim(),
        entries: [],
      };
      continue;
    }

    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SteamID') {
      current.entries.push({
        id: crypto.randomUUID(),
        steamId: (node.getAttribute('id') || '').trim(),
        name: node.getAttribute('name') || '',
        showColors: node.getAttribute('showColors') !== '0',
        avatar: null,
        valid: null,
        loading: false,
      });
    }
  }

  groups.push(current);
  return groups;
}

export function parseCfg(text) {
  const lines = (text || '').split(/\r?\n/);
  const entries = [];
  let index = 0;

  while (index < lines.length) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const groupMatch = trimmed.match(/^(?:\/\/|#)\s*(.+?)\s*$/);
    if (groupMatch) {
      const name = groupMatch[1];
      const groupEntries = [];
      index += 1;
      while (index < lines.length) {
        const line = lines[index].trim();
        if (/^(?:\/\/|#)\s*END\b/i.test(line)) {
          index += 1;
          break;
        }
        if (!line || line.startsWith('//') || line.startsWith('#')) {
          index += 1;
          continue;
        }
        const separatorIndex = line.indexOf('=');
        if (separatorIndex === -1) {
          index += 1;
          continue;
        }
        groupEntries.push({
          id: crypto.randomUUID(),
          key: line.slice(0, separatorIndex).trim(),
          value: line.slice(separatorIndex + 1).trim(),
          duplicate: false,
        });
        index += 1;
      }
      if (groupEntries.length) {
        entries.push({
          id: crypto.randomUUID(),
          type: 'group',
          name: name.trim(),
          entries: groupEntries,
        });
      }
      continue;
    }

    if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
      index += 1;
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      index += 1;
      continue;
    }

    entries.push({
      id: crypto.randomUUID(),
      type: 'entry',
      key: trimmed.slice(0, separatorIndex).trim(),
      value: trimmed.slice(separatorIndex + 1).trim(),
      duplicate: false,
    });
    index += 1;
  }

  return entries;
}

function escapeXmlAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildPrivilegesXml(groups) {
  const lines = [
    '<Privileges>',
    '    <Privilege Name="Administrator">',
    '        <SteamIDs>',
  ];

  for (const group of groups || []) {
    if (group.comment) lines.push(`            <!-- ${group.comment} -->`);
    for (const entry of group.entries || []) {
      lines.push(`            <SteamID id="${escapeXmlAttr(entry.steamId)}" showColors="1" name="${escapeXmlAttr(entry.name)}"/>`);
    }
  }

  lines.push('        </SteamIDs>');
  lines.push('        <Commands bHasPrevious="true">');
  [
    'Lobby.Kick.RichId',
    'Chat.SystemMessage',
    'Online.Server.Password',
    'sv_servername',
    'Ban.User.SteamID',
    'Admin.ShowAdminStatus',
    'weather.stormfactor.setnewtarget',
    'e_timeofday',
    'game.skirmish.setnextarea',
    'game.skirmish.forceendround',
    'g_teamSizeMaxUserPercentageDifference',
  ].forEach((command) => lines.push(`            <Command Name="${command}"/>`));
  lines.push('        </Commands>');
  lines.push('    </Privilege>');
  lines.push('</Privileges>');

  return lines.join('\n');
}

export function buildCfg(entries) {
  const lines = [];
  for (const item of entries || []) {
    if (item.type === 'group') {
      lines.push(`# ${item.name}`);
      for (const entry of item.entries || []) {
        lines.push(`${entry.key}=${entry.value}`);
      }
      lines.push(`# END ${item.name}`);
      continue;
    }
    lines.push(`${item.key}=${item.value}`);
  }
  return lines.join('\n');
}

export function serializeDocument(state) {
  return state.fileType === FILE_TYPES.CFG
    ? buildCfg(state.cfgEntries)
    : buildPrivilegesXml(state.groups);
}

export function parseDocument(text, fileType) {
  if (fileType === FILE_TYPES.CFG) {
    return {
      fileType,
      groups: [],
      cfgEntries: parseCfg(text),
    };
  }

  return {
    fileType,
    groups: parsePrivilegesXml(text),
    cfgEntries: [],
  };
}

export function findDuplicateCfgKeys(entries) {
  const byKey = new Map();
  for (const item of entries || []) {
    if (item.type === 'group') {
      for (const entry of item.entries || []) {
        const key = entry.key.trim();
        if (!key) continue;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(entry.id);
      }
      continue;
    }
    const key = item.key.trim();
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(item.id);
  }

  return Array.from(byKey.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids }));
}
