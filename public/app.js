/*
 * File: c:\Users\tonyw\Desktop\PRIVS\public\app.js
 * Project: c:\Users\tonyw\Desktop\PRIVS\privileges-editor
 * Created Date: Saturday January 31st 2026
 * Author: Tony Wiedman
 * -----
 * Last Modified: Sat February 14th 2026 12:54:24 
 * Modified By: Tony Wiedman
 * -----
 * Copyright (c) 2026 MolexWorks
 */

import { validateBatch, validateSingle as apiValidateSingle, resolveSteamProfile as apiResolveSteamProfile, doFtpUpload as apiDoFtpUpload } from './modules/api.js';
import { parsePrivilegesXml as parserParse, parseCfg as parserParseCfg, buildCfg as parserBuildCfg } from './modules/parser.js';
import { buildXml as xmlBuild } from './modules/xmlbuilder.js';
import { renderGroups, renderCfg } from './modules/render.js';
import { showToast, showProfileModal } from './modules/helpers.js';
import { updateFtpDisplay } from './modules/ftp.js';

export default class ServerEditor
{
  //! constructor - initialize editor state
  //! \returns new ServerEditor instance
  constructor()
  {
    this.state = { groups: [], debounce: {}, ftpCredentials: null };
    this.observer = new MutationObserver(() => { });
  }

  //! hasUnsavedChanges - compare current build against last loaded raw
  //! \returns boolean
  hasUnsavedChanges()
  {
    try
    {
      const fileType = document.getElementById('fileTypeSelect')?.value || 'privileges';
      const current = fileType === 'cfg' ? this.buildCfg() : this.buildXml();
      const last = this.state.lastLoadedRaw || '';
      return String(current || '') !== String(last || '');
    } catch (e) { return false; }
  }

  //! setStep - update UI step visibility and perform step-specific actions
  //! \param n - step number
  setStep(n)
  {
    try { if (typeof this.updateValidationBadge === 'function') this.updateValidationBadge(); } catch (e) { }
    const steps = [1, 2, 3];
    steps.forEach(s => document.getElementById('step' + s)?.classList.toggle('d-none', n !== s));
    steps.forEach(s => document.getElementById('step' + s + 'btn')?.classList.toggle('active', n === s));
    const step2btn = document.getElementById('step2btn');
    const step3btn = document.getElementById('step3btn');
    if (step2btn) step2btn.disabled = n < 2;
    if (step3btn) step3btn.disabled = n < 2;

    try
    {
      const anyInvalid = (this.state.groups || []).some(g => (g.entries || []).some(e => e.valid === false));
      this.state.hasValidationErrors = !!anyInvalid;
      try { const step3btn = document.getElementById('step3btn'); if (step3btn) step3btn.disabled = !!this.state.hasValidationErrors; } catch (e) { }
    } catch (e) { }
    if (n === 3)
    {
      try
      {
        const fileType = document.getElementById('fileTypeSelect')?.value || (this.state.currentFileType || ((this.state.cfgEntries && this.state.cfgEntries.length) ? 'cfg' : 'privileges'));
        if (fileType === 'cfg') { if (!this.validateCfg()) return; }
      } catch (e) { }
      updateFtpDisplay(this);
      try
      {
        const fileType = document.getElementById('fileTypeSelect')?.value || (this.state.currentFileType || ((this.state.cfgEntries && this.state.cfgEntries.length) ? 'cfg' : 'privileges'));
        const txt = fileType === 'cfg' ? this.buildCfg() : this.buildXml();
        const exportEl = document.getElementById('exportXml'); if (exportEl) exportEl.value = txt;
      } catch (e) { }
    }
  }

  //! updateValidationBadge - show/hide validation badge in stepper
  updateValidationBadge()
  {
    try
    {
      const badge = document.getElementById('stepperValidationBadge');
      if (!badge) return;
      const hasIssues = !!(this.state && (this.state.cfgHasDuplicates || this.state.hasValidationErrors));
      badge.style.display = hasIssues ? 'inline-block' : 'none';
    } catch (e) { }
  }

  //! escapeHtml - escape text for safe insertion into DOM
  //! \param s - input string
  escapeHtml(s)
  {
    return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  escapeXmlAttr(s) { return (s || '').replace(/"/g, '&quot;'); }

  //! parsePrivilegesXml - wrapper to parser.parsePrivilegesXml
  //! \param xmlText - xml string
  parsePrivilegesXml(xmlText)
  {
    return parserParse(xmlText || '');
  }

  //! parseCfg - wrapper to parser.parseCfg
  //! \param text - cfg text
  parseCfg(text)
  {
    return parserParseCfg(text || '');
  }

  //! updateId - update entry id and attempt resolution/validation
  //! \param g - group index
  //! \param i - entry index
  //! \param val - new id value
  async updateId(g, i, val)
  {
    const v = (val || '').trim();
    const entry = this.state.groups[g]?.entries[i];
    if (!entry) return;
    entry.id = v;
    const key = `${g}-${i}`;
    const looksLikeUrl = /steamcommunity\.com|steam:\/\//i.test(v) || /\/id\/|\/profiles\//i.test(v);
    if (looksLikeUrl)
    {
      if (this.state.debounce[key]) { clearTimeout(this.state.debounce[key]); delete this.state.debounce[key]; }
      entry.loading = true; entry.valid = null; renderGroups(this);
      try
      {
        const resolved = await apiResolveSteamProfile(v);
        try { console.debug('[client] resolveSteamProfile returned', resolved); } catch (e) { }
        if (resolved && resolved.steamid64)
        {
          entry.id = resolved.steamid64;
          entry.avatar = resolved.avatar || null;
          if (resolved.name && !entry.name) entry.name = resolved.name;
          const result = await apiValidateSingle(resolved.steamid64);
          try { console.debug('[client] validateSingle returned', result); } catch (e) { }
          entry.valid = result ? result.valid : false;
          entry.avatar = result && result.avatar ? result.avatar : entry.avatar;
          if (result && result.name && !entry.name) entry.name = result.name;
        } else { entry.valid = false; entry.avatar = null; }
      } catch (e) { entry.valid = false; entry.avatar = null; }
      entry.loading = false; renderGroups(this);
      return;
    }

    if (!/^\d{17}$/.test(v))
    {
      if (this.state.debounce[key]) { clearTimeout(this.state.debounce[key]); delete this.state.debounce[key]; }
      if (entry.loading || entry.valid !== null || entry.avatar !== null)
      {
        entry.loading = false; entry.valid = null; entry.avatar = null; renderGroups(this);
      }
      return;
    }

    if (this.state.debounce[key]) clearTimeout(this.state.debounce[key]);
    this.state.debounce[key] = setTimeout(async () =>
    {
      const e = this.state.groups[g]?.entries[i]; if (!e) return;
      e.loading = true; renderGroups(this);
      const result = await apiValidateSingle(e.id);
      e.loading = false;
      if (result) { e.valid = result.valid; e.avatar = result.avatar || null; if (result.name && !e.name) e.name = result.name; }
      else { e.valid = false; e.avatar = null; }
      renderGroups(this); delete this.state.debounce[key];
    }, 700);
  }

  //! updateName - update an entry's name
  //! \param g - group index
  //! \param i - entry index
  //! \param val - new name
  updateName(g, i, val) { if (this.state.groups[g]) this.state.groups[g].entries[i].name = val; }

  //! updateShow - toggle showColors flag
  //! \param g - group index
  //! \param i - entry index
  //! \param checked - boolean
  updateShow(g, i, checked) { if (this.state.groups[g]) this.state.groups[g].entries[i].showColors = checked ? '1' : '0'; }

  //! updateGroupName - update group's comment/name
  //! \param g - group index
  //! \param val - new comment
  updateGroupName(g, val) { if (this.state.groups[g]) this.state.groups[g].comment = val; }

  //! addLine - add an empty entry to group
  //! \param gIdx - group index
  addLine(gIdx) { this.state.groups[gIdx].entries.push({ id: '', name: '', showColors: '1', avatar: null, valid: null }); renderGroups(this); }

  //! removeLine - remove entry from group
  //! \param g - group index
  //! \param i - entry index
  removeLine(g, i) { this.state.groups[g].entries.splice(i, 1); renderGroups(this); }

  //! removeGroup - remove entire group
  //! \param i - group index
  removeGroup(i) { this.state.groups.splice(i, 1); renderGroups(this); }

  //! addGroup - create new group with default comment
  addGroup() { this.state.groups.push({ comment: 'New group', entries: [] }); renderGroups(this); }

  addCfgLine()
  {
    //! addCfgLine - append an entry row to cfg editor
    this.state.cfgEntries = this.state.cfgEntries || [];
    this.state.cfgEntries.push({ type: 'entry', key: '', value: '' });
    try { renderCfg(this); } catch (e) { }
    try { this.validateCfg(); } catch (e) { }
  }

  addCfgGroup(preset)
  {
    //! addCfgGroup - add group block from preset
    this.state.cfgEntries = this.state.cfgEntries || [];
    const block = { type: 'group', name: preset.name || 'Preset', entries: (preset.entries || []).map(e => ({ key: e.key, value: e.value })) };
    this.state.cfgEntries.push(block);
    try { renderCfg(this); } catch (e) { }
    try { this.validateCfg(); } catch (e) { }
  }

  updateCfgKey(g, i, val)
  {
    //! updateCfgKey - update key in cfg entries
    if (!this.state.cfgEntries) return;
    if (g === null || typeof g === 'undefined')
    {
      const it = this.state.cfgEntries[i]; if (it && it.type === 'entry') it.key = val; try { this.validateCfg(); } catch (e) { } return;
    }
    const grp = this.state.cfgEntries[g]; if (!grp || grp.type !== 'group') return; if (grp.entries && grp.entries[i]) grp.entries[i].key = val;
    try { this.validateCfg(); } catch (e) { }
  }

  updateCfgValue(g, i, val)
  {
    //! updateCfgValue - update value in cfg entries
    if (!this.state.cfgEntries) return;
    if (g === null || typeof g === 'undefined')
    {
      const it = this.state.cfgEntries[i]; if (it && it.type === 'entry') it.value = val; try { this.validateCfg(); } catch (e) { } return;
    }
    const grp = this.state.cfgEntries[g]; if (!grp || grp.type !== 'group') return; if (grp.entries && grp.entries[i]) grp.entries[i].value = val;
    try { this.validateCfg(); } catch (e) { }
  }

  removeCfgLine(g, i)
  {
    //! removeCfgLine - remove a cfg entry
    if (!this.state.cfgEntries) return;
    if (g === null || typeof g === 'undefined') { this.state.cfgEntries.splice(i, 1); try { renderCfg(this); } catch (e) { } return; }
    const grp = this.state.cfgEntries[g]; if (!grp || grp.type !== 'group') return; grp.entries.splice(i, 1); try { renderCfg(this); } catch (e) { }
    try { this.validateCfg(); } catch (e) { }
  }

  removeCfgGroup(g)
  {
    //! removeCfgGroup - remove a cfg group
    if (!this.state.cfgEntries) return; this.state.cfgEntries.splice(g, 1); try { renderCfg(this); } catch (e) { }
    try { this.validateCfg(); } catch (e) { }
  }

  async validateAll()
  {
    //! validateAll - validate all steam ids via batch API
    const ids = [];
    this.state.groups.forEach(g => g.entries.forEach(e => { if (e.id && /^\d{17}$/.test(e.id)) ids.push(e.id); }));
    if (!ids.length) return;
    this.state.groups.forEach(g => g.entries.forEach(e => { if (e.id && /^\d{17}$/.test(e.id)) e.loading = true; }));
    renderGroups(this);
    try
    {
      const anyInvalid = (this.state.groups || []).some(g => (g.entries || []).some(e => e.valid === false));
      this.state.hasValidationErrors = !!anyInvalid;
      try { const step3btn = document.getElementById('step3btn'); if (step3btn) step3btn.disabled = !!this.state.hasValidationErrors; } catch (e) { }
    } catch (e) { }
    const results = await validateBatch(ids);
    const map = {};
    (results || []).forEach(it => map[it.id] = it);
    this.state.groups.forEach(g => g.entries.forEach(e =>
    {
      if (e.id && /^\d{17}$/.test(e.id))
      {
        const m = map[e.id];
        if (m) { e.valid = m.valid; e.avatar = m.avatar || null; if (m.name && !e.name) e.name = m.name; }
        else { e.valid = false; e.avatar = null; }
        e.loading = false;
      }
    }));
    renderGroups(this);
    try
    {
      const anyInvalidAfter = (this.state.groups || []).some(g => (g.entries || []).some(e => e.valid === false));
      this.state.hasValidationErrors = !!anyInvalidAfter;
      try { const step3btn = document.getElementById('step3btn'); if (step3btn) step3btn.disabled = !!this.state.hasValidationErrors; } catch (e) { }
    } catch (e) { }
  }

  //! validateSingle - wrapper to api validateSingle
  //! \param id - steamid64 string
  async validateSingle(id)
  {
    return await apiValidateSingle(id);
  }

  //! resolveSteamProfile - wrapper to api resolveSteamProfile
  //! \param profileUrl - profile url or identifier
  async resolveSteamProfile(profileUrl)
  {
    return await apiResolveSteamProfile(profileUrl);
  }

  //! buildXml - build privileges XML via xmlbuilder
  buildXml()
  {
    return xmlBuild(this.state);
  }

  //! buildCfg - build dedicated.cfg text via parser
  buildCfg()
  {
    return parserBuildCfg(this.state.cfgEntries || []);
  }

  //! validateCfg - validate cfg entries for duplicates
  validateCfg()
  {
    try
    {
      const items = this.state.cfgEntries || [];
      const map = {};
      const refs = [];
      items.forEach((it, idx) =>
      {
        if (it.type === 'entry')
        {
          const k = (it.key || '').trim();
          refs.push({ key: k, obj: it });
        }
        else if (it.type === 'group')
        {
          (it.entries || []).forEach(e => { refs.push({ key: (e.key || '').trim(), obj: e }); });
        }
      });
      refs.forEach(r => { const k = r.key || ''; if (!k) return; map[k] = map[k] || []; map[k].push(r.obj); });
      let hasDup = false;
      Object.keys(map).forEach(k =>
      {
        const arr = map[k] || [];
        if (arr.length > 1)
        {
          hasDup = true;
          arr.forEach(o => o.duplicate = true);
        }
        else if (arr.length === 1)
        {
          arr[0].duplicate = false;
        }
      });
      refs.forEach(r => { if (!r.key) r.obj.duplicate = false; });
      try { import('./modules/render.js').then(m => { if (m && m.renderCfg) m.renderCfg(this); }).catch(() => { }); } catch (e) { }
      try { this.state.cfgHasDuplicates = !!hasDup; } catch (e) { }
      try { const step3btn = document.getElementById('step3btn'); if (step3btn) step3btn.disabled = !!this.state.cfgHasDuplicates; } catch (e) { }
      try { if (typeof this.updateValidationBadge === 'function') this.updateValidationBadge(); } catch (e) { }
      if (hasDup)
      {
        try
        {
          // build a short list of duplicate keys for the toast
          const dupKeys = Object.keys(map).filter(k => (map[k] || []).length > 1);
          const maxShow = 6;
          const shown = dupKeys.slice(0, maxShow).join(', ');
          const more = dupKeys.length > maxShow ? ` (+${dupKeys.length - maxShow} more)` : '';
          const msg = `Duplicate cfg keys detected: ${shown}${more}. Remove duplicates before exporting.`;
          this.showToast(msg, [{
            label: 'Focus first duplicate', style: 'btn btn-sm btn-outline-secondary', onClick: () =>
            {
              try
              {
                const el = document.querySelector('.cfg-line .is-invalid');
                if (el && typeof el.focus === 'function') el.focus();
              } catch (e) { }
            }
          }, { label: 'Dismiss', style: 'btn btn-sm btn-outline-secondary', onClick: () => { } }], { type: 'error' });
        } catch (e) { try { this.showToast('Duplicate cfg keys detected — remove duplicates before exporting', null, { type: 'error' }); } catch (ee) { } }
      }
      return !hasDup;
    } catch (e) { return true; }
  }

  //! doFtpUpload - wrapper to api.doFtpUpload for class
  //! \param {host,port,user,pass,content} - ftp options (content may be XML or CFG text)
  async doFtpUpload({ host, port, user, pass, content })
  {
    const resDiv = document.getElementById('ftpResult'); if (resDiv) resDiv.innerText = 'Uploading...';
    try
    {
      const remotePathEl = document.getElementById('ftpModalRemotePath');
      const remotePath = remotePathEl ? remotePathEl.value.trim() : '/Assets/privileges.xml';
      const payload = content || '';
      const r = await apiDoFtpUpload({ host, port, user, pass, content: payload, remotePath });
      const j = r.json || {};
      if (r.ok) { if (resDiv) resDiv.innerText = 'Uploaded: ' + (j.uploadedTo || 'ok'); showToast('Upload successful', null, { type: 'success' }); }
      else { if (resDiv) resDiv.innerText = 'Error: ' + (j.error || JSON.stringify(j)); showToast('Upload error: ' + (j.error || JSON.stringify(j))); }
    } catch (e) { if (resDiv) resDiv.innerText = 'Error: ' + e.message; showToast('Upload error: ' + e.message); }
  }

  showToast(message, actions, opts)
  {
    //! showToast - forward to helpers.showToast
    return showToast(message, actions, opts);
  }

  showProfileModal(steamid)
  {
    //! showProfileModal - forward to helpers.showProfileModal
    return showProfileModal(steamid);
  }

  init()
  {
    //! init - attach global and perform initialization
    window.serverApp = this;
  }
}