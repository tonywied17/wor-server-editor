import { renderGroups, renderCfg } from './render.js';
import { detectFileType } from './parser.js';
import { showToast, showConfirm } from './helpers.js';

//! bindUi - wire up UI controls to the app
//! \param app - ServerEditor instance
export function bindUi(app)
{
    if (!app) return;

    document.getElementById('loadBtn')?.addEventListener('click', async () =>
    {
        const txt = document.getElementById('pasteXml').value.trim(); if (!txt) { showToast('Paste some text or upload a file', null, { type: 'error' }); return; }
        const fileType = document.getElementById('fileTypeSelect')?.value || 'privileges';
        try
        {
            const detected = typeof detectFileType === 'function' ? detectFileType(txt) : 'unknown';
            if (detected && detected !== 'unknown' && detected !== fileType)
            {
                if (!await showConfirm(`Content looks like ${detected}. Switch the file type to ${detected} and load it?`)) return;
                const fileTypeEl = document.getElementById('fileTypeSelect'); if (fileTypeEl) { fileTypeEl.value = detected; }
                try { app.state.currentFileType = detected; } catch (e) { }
                try { if (window.applyFileTypeUI) window.applyFileTypeUI(); } catch (e) { }
                if (detected === 'cfg') { app.state.cfgEntries = app.parseCfg(txt); renderCfg(app); app.state.lastLoadedRaw = txt; app.setStep(2); return; }
                else { app.state.groups = app.parsePrivilegesXml(txt); renderGroups(app); app.validateAll().then(() => { app.state.lastLoadedRaw = txt; app.setStep(2); }); return; }
            }
        } catch (e) { }

        if (fileType === 'cfg')
        {
            app.state.cfgEntries = app.parseCfg(txt);
            renderCfg(app);
            app.state.lastLoadedRaw = txt;
            app.setStep(2);
            return;
        }
        app.state.groups = app.parsePrivilegesXml(txt); renderGroups(app); app.validateAll().then(() => { app.state.lastLoadedRaw = txt; app.setStep(2); });
    });

    document.getElementById('newBtn')?.addEventListener('click', (e) =>
    {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        const fileType = document.getElementById('fileTypeSelect')?.value || 'privileges';
        if (fileType === 'cfg')
        {
            app.state.cfgEntries = [{ key: '', value: '' }]; renderCfg(app); app.setStep(2); return;
        }
        app.state.groups = [{ comment: 'Default', entries: [{ id: '', name: '', showColors: '1', avatar: null, valid: null }] }]; renderGroups(app); app.setStep(2);
    });

    const fileInputEl = document.getElementById('fileInput');
    document.getElementById('fileInput')?.addEventListener('change', async (ev) =>
    {
        const f = ev.target.files[0]; if (!f) return; const txt = await f.text(); document.getElementById('pasteXml').value = txt;
        try
        {
            let fileTypeEl = document.getElementById('fileTypeSelect');
            let fileType = fileTypeEl?.value || 'privileges';
            try
            {
                const detected = typeof detectFileType === 'function' ? detectFileType(txt) : null;
                if (detected && detected !== 'unknown' && detected !== fileType)
                {
                    if (fileTypeEl) fileTypeEl.value = detected;
                    try { app.state.currentFileType = detected; } catch (e) { }
                    try { if (window.applyFileTypeUI) window.applyFileTypeUI(); } catch (e) { }
                    fileType = detected;
                }
            } catch (e) { }

            if (fileType === 'cfg') { app.state.cfgEntries = app.parseCfg(txt); renderCfg(app); app.state.lastLoadedRaw = txt; app.setStep(2); return; }
            app.state.groups = app.parsePrivilegesXml(txt); renderGroups(app); await app.validateAll(); app.state.lastLoadedRaw = txt; app.setStep(2);
        } catch (e) { console.error('Failed parsing uploaded file', e); showToast('Failed to parse file', null, { type: 'error' }); }
    });

    const fileDrop = document.getElementById('fileDrop');
    if (fileDrop && fileInputEl)
    {
        fileDrop.style.cursor = 'pointer';
        fileDrop.addEventListener('click', (ev) => { try { fileInputEl.click(); } catch (e) { } });
    }

    const pasteArea = document.getElementById('pasteXml');
    if (pasteArea)
    {
        pasteArea.addEventListener('dragover', (e) => { e.preventDefault(); pasteArea.classList.add('dragover'); });
        ['dragleave', 'dragend'].forEach(ev => pasteArea.addEventListener(ev, () => pasteArea.classList.remove('dragover')));
        pasteArea.addEventListener('drop', async (e) =>
        {
            e.preventDefault(); pasteArea.classList.remove('dragover'); const f = e.dataTransfer.files?.[0];
            if (f) { const txt = await f.text(); pasteArea.value = txt; try { let fileTypeEl = document.getElementById('fileTypeSelect'); let fileType = fileTypeEl?.value || 'privileges'; try { const detected = typeof detectFileType === 'function' ? detectFileType(txt) : null; if (detected && detected !== fileType && detected !== 'unknown') { if (fileTypeEl) fileTypeEl.value = detected; try { app.state.currentFileType = detected; } catch (e) { } try { if (window.applyFileTypeUI) window.applyFileTypeUI(); } catch (e) { } fileType = detected; } } catch (e) { } if (fileType === 'cfg') { app.state.cfgEntries = app.parseCfg(txt); renderCfg(app); app.setStep(2); } else { app.state.groups = app.parsePrivilegesXml(txt); renderGroups(app); await app.validateAll(); app.setStep(2); } } catch (err) { showToast('Failed to parse dropped file', null, { type: 'error' }); } return; }
            const txt = e.dataTransfer.getData('text'); if (txt) { pasteArea.value = txt; try { let fileTypeEl = document.getElementById('fileTypeSelect'); let fileType = fileTypeEl?.value || 'privileges'; try { const detected = typeof detectFileType === 'function' ? detectFileType(txt) : null; if (detected && detected !== fileType && detected !== 'unknown') { if (fileTypeEl) fileTypeEl.value = detected; try { app.state.currentFileType = detected; } catch (e) { } try { if (window.applyFileTypeUI) window.applyFileTypeUI(); } catch (e) { } fileType = detected; } } catch (e) { } if (fileType === 'cfg') { app.state.cfgEntries = app.parseCfg(txt); renderCfg(app); app.setStep(2); } else { app.state.groups = app.parsePrivilegesXml(txt); renderGroups(app); await app.validateAll(); app.setStep(2); } } catch (err) { showToast('Failed to parse dropped text', null, { type: 'error' }); } }
        });
    }

    document.getElementById('addGroupBtn')?.addEventListener('click', () => { app.addGroup(); });
    document.getElementById('exportInEditBtn')?.addEventListener('click', () =>
    {
        let fileTypeEl = document.getElementById('fileTypeSelect');
        let fileType = fileTypeEl ? fileTypeEl.value : null;
        if (!fileType)
        {
            fileType = (app.state && Array.isArray(app.state.cfgEntries) && app.state.cfgEntries.length) ? 'cfg' : 'privileges';
        }
        if (fileType === 'cfg')
        {
            try
            {
                if (!app.validateCfg()) return;
            } catch (e) { }
        }
        const txt = fileType === 'cfg' ? app.buildCfg() : app.buildXml();
        const exportEl = document.getElementById('exportXml'); if (exportEl) exportEl.value = txt;
        app.setStep(3);
    });

    document.getElementById('downloadBtn')?.addEventListener('click', () =>
    {
        const fileType = document.getElementById('fileTypeSelect')?.value || 'privileges';
        const txt = fileType === 'cfg' ? app.buildCfg() : app.buildXml();
        const mime = fileType === 'cfg' ? 'text/plain' : 'application/xml';
        const name = fileType === 'cfg' ? 'dedicated.cfg' : 'server_file';
        const blob = new Blob([txt], { type: mime }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
    });

    document.getElementById('copyBtn')?.addEventListener('click', async () =>
    {
        try
        {
            const fileTypeEl = document.getElementById('fileTypeSelect');
            let fileType = fileTypeEl?.value || (app.state && app.state.currentFileType) || 'privileges';
            if (!fileType && app && Array.isArray(app.state && app.state.cfgEntries) && app.state.cfgEntries.length) fileType = 'cfg';
            const txt = fileType === 'cfg' ? app.buildCfg() : app.buildXml();
            const exportEl = document.getElementById('exportXml');
            if (exportEl)
            {
                exportEl.value = txt;
                try { exportEl.select(); exportEl.setSelectionRange(0, txt.length); } catch (e) { }
            }
            if (navigator.clipboard && navigator.clipboard.writeText)
            {
                await navigator.clipboard.writeText(txt);
                showToast('Copied', null, { type: 'success' });
                return;
            }
            try { const succeeded = document.execCommand && document.execCommand('copy'); if (succeeded) { showToast('Copied', null, { type: 'success' }); return; } } catch (e) { }
            showToast('Copy failed', null, { type: 'error' });
        } catch (e) { console.error('Copy error', e); showToast('Copy failed', null, { type: 'error' }); }
    });
}
