export const cfgPresets = [
  {
    name: 'Disable Capture Point',
    entries: [
      { key: 'g_captureZoneSpeed', value: '0' },
      { key: 'g_captureZoneNeutralizeSpeed', value: '0' },
      { key: 'g_captureZoneMaxPlayers', value: '0' },
      { key: 'g_gameEndingEvents', value: '0' },
    ],
  },
  {
    name: 'Turn Off Class Restrictions',
    entries: [
      { key: 'Game.Outfitter.Restrictions', value: '0' },
    ],
  },
];

/** Game mode presets — each defines sv_gamerules and optional extra keys. */
export const gameModePresets = [
  {
    id: 'skirmish-antietam',
    label: 'Skirmishes — Antietam',
    category: 'Skirmishes',
    sets: { sv_gamerules: 'Skirmish' },
    removes: ['g_drillcampfaction'],
  },
  {
    id: 'skirmish-harpersferry',
    label: 'Skirmishes — Harpers Ferry',
    category: 'Skirmishes',
    sets: { sv_gamerules: 'Skirmish' },
    removes: ['g_drillcampfaction'],
  },
  {
    id: 'skirmish-southmountain',
    label: 'Skirmishes — South Mountain',
    category: 'Skirmishes',
    sets: { sv_gamerules: 'Skirmish' },
    removes: ['g_drillcampfaction'],
  },
  {
    id: 'drillcamp-usa',
    label: 'Drill Camp — USA',
    category: 'Drill Camp',
    sets: { sv_gamerules: 'DrillCamp', g_drillcampfaction: '1' },
    removes: [],
  },
  {
    id: 'drillcamp-csa',
    label: 'Drill Camp — CSA',
    category: 'Drill Camp',
    sets: { sv_gamerules: 'DrillCamp', g_drillcampfaction: '2' },
    removes: [],
  },
  {
    id: 'picketpatrol',
    label: 'Picket Patrol',
    category: 'Other',
    sets: { sv_gamerules: 'PicketPatrol' },
    removes: ['g_drillcampfaction'],
  },
  {
    id: 'conquest-antietam',
    label: 'Conquest — Antietam',
    category: 'Conquest',
    sets: { sv_gamerules: 'Conquest' },
    removes: ['g_drillcampfaction'],
  },
  {
    id: 'conquest-drillcamp',
    label: 'Conquest — Drill Camp',
    category: 'Conquest',
    sets: { sv_gamerules: 'Conquest' },
    removes: ['g_drillcampfaction'],
  },
  {
    id: 'conquest-harpersferry',
    label: 'Conquest — Harpers Ferry',
    category: 'Conquest',
    sets: { sv_gamerules: 'Conquest' },
    removes: ['g_drillcampfaction'],
  },
];

/** Well-known server keys with human-readable labels and descriptions. */
export const knownServerKeys = {
  'Online.Server.Name': { label: 'Server name', description: 'The name shown in the server browser.' },
  'Online.Server.Capacity': { label: 'Max slots', description: 'Maximum amount of players on the server.' },
  'Online.Server.Port': { label: 'Server port', description: 'Main game port.' },
  'Online.Server.SteamPort': { label: 'Steam port', description: 'Steam query port.' },
  'Online.Server.Steam.AccountToken': { label: 'Steam token', description: 'Game Server Login Token. Required to start the server.' },
  'Online.Server.Password': { label: 'Server password', description: 'Set a server password for your game server.' },
  'Online.Server.RconPassword': { label: 'RCON password', description: 'Remote console access password.' },
  'sv_gamerules': { label: 'Game rules', description: 'The active game mode.' },
  'sv_bind': { label: 'Bind address', description: 'Network address the server binds to.' },
  'sv_port': { label: 'SV port', description: 'CryEngine server port.' },
  'g_drillcampfaction': { label: 'Drill Camp faction', description: '1 = USA, 2 = CSA. Only used with DrillCamp game rules.' },
  g_teamSizeMaxUserPercentageDifference: { label: 'Team auto-balance', description: 'Enabled writes g_teamSizeMaxUserPercentageDifference=1. Disabled removes the key.' },
  'Demotion.System.Enabled': { label: 'Demotion system', description: '0 = disabled, 1 = enabled.' },
};
