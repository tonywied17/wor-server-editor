import ServerEditor from '../app.js';
import { bindUi } from './ui.js';
import { bind as bindFtp, quickDownload, fetchRemoteFile } from './ftp.js';
import { renderGroups } from './render.js';
import { showConfirm } from './helpers.js';

try
{
    const app = new ServerEditor();
    app.init();

    fetch('/data/cfg.presets.json')
        .then(r => (r.ok ? r.json() : []))
        .then(j => { app.state.cfgPresets = Array.isArray(j) ? j : []; })
        .catch(() => { app.state.cfgPresets = []; });

    if (bindUi) bindUi(app);
    if (bindFtp) bindFtp(app);
    if (renderGroups) renderGroups(app);

    const fileTypeEl = document.getElementById('fileTypeSelect');

    //! applyFileTypeUI - update UI controls to match selected file type
    //! \returns void
    function applyFileTypeUI()
    {
        const fileType = fileTypeEl?.value || 'privileges';
        try { app.state.currentFileType = fileType; } catch (e) { }

        const paste = document.getElementById('pasteXml');
        const newBtn = document.getElementById('newBtn');
        const addGroupBtn = document.getElementById('addGroupBtn');
        const step2Header = document.querySelector('#step2 h5');

        if (paste)
        {
            paste.placeholder = fileType === 'cfg'
                ? 'Paste dedicated.cfg contents here'
                : 'Paste contents or drag & drop server file here';
        }

        if (newBtn)
        {
            newBtn.textContent = fileType === 'cfg' ? 'new blank dedicated.cfg' : 'new blank privileges.xml';
        }

        if (fileType === 'cfg')
        {
            if (addGroupBtn) addGroupBtn.style.display = 'none';
            if (step2Header) { step2Header.style.display = 'none'; step2Header.textContent = ''; }
            if (app.state.cfgEntries)
            {
                import('./render.js').then(m => { if (m && m.renderCfg) m.renderCfg(app); }).catch(() => { });
            }
        } else
        {
            if (addGroupBtn) addGroupBtn.style.display = '';
            if (step2Header) { step2Header.style.display = ''; step2Header.textContent = 'Edit Steam IDs'; }
            if (app.state.groups) renderGroups(app);
        }

        const loadBtn = document.getElementById('loadBtn');
        if (loadBtn) loadBtn.textContent = fileType === 'cfg' ? 'Edit CFG >' : 'Edit Server File >';

        const step3Header = document.querySelector('#step3 h5');
        if (step3Header) step3Header.textContent = fileType === 'cfg' ? 'Export CFG' : 'Export File';

        const downloadBtn = document.getElementById('downloadBtn');
        if (downloadBtn) downloadBtn.textContent = fileType === 'cfg' ? 'Download CFG' : 'Download File';
    }

    try { window.applyFileTypeUI = applyFileTypeUI; } catch (e) { }

    //! awaitRenderCfg - ensure render module is loaded and render cfg
    //! \param app - ServerEditor instance
    function awaitRenderCfg(app)
    {
        import('./render.js')
            .then(m => { if (m && m.renderCfg) m.renderCfg(app); })
            .catch(() => { });
    }

    fileTypeEl?.addEventListener('change', async () =>
    {
        applyFileTypeUI();

        try
        {
            const creds = app.state.ftpCredentials;
            const fileTypeCurr = fileTypeEl?.value || 'privileges';
            const defaultPath = fileTypeCurr === 'cfg' ? '/dedicated.cfg' : '/Assets/privileges.xml';
            const expectSuffix = fileTypeCurr === 'cfg' ? 'dedicated.cfg' : 'privileges.xml';

            if (creds)
            {
                const storedPath = creds.remotePath || '';
                const usePath = (storedPath && storedPath.endsWith(expectSuffix)) ? storedPath : defaultPath;
                app.state.ftpCredentials = Object.assign({}, creds, { remotePath: usePath });
                try { window.dispatchEvent(new CustomEvent('ftpCredsChanged')); } catch (e) { }
            }
        } catch (e) { }

        try
        {
            const step1Visible = !document.getElementById('step1')?.classList.contains('d-none');
            const step2Visible = !document.getElementById('step2')?.classList.contains('d-none');
            const step3Visible = !document.getElementById('step3')?.classList.contains('d-none');
            const creds = app.state.ftpCredentials;

            if ((step1Visible || step2Visible || step3Visible) && creds && creds.host && creds.user)
            {
                const fileType = fileTypeEl?.value || 'privileges';

                if (app.hasUnsavedChanges && app.hasUnsavedChanges())
                {
                    if (!(await showConfirm('You have unsaved changes. Loading the server file will overwrite them. Continue?'))) return;
                }

                const txt = await fetchRemoteFile(app, fileType);
                if (txt === null) return;

                if (step1Visible)
                {
                    const paste = document.getElementById('pasteXml');
                    if (paste) paste.value = txt;
                    app.state.lastLoadedRaw = txt;
                    return;
                }

                if (step2Visible)
                {
                    if (fileType === 'cfg')
                    {
                        app.state.cfgEntries = app.parseCfg(txt || '');
                        try { const m = await import('./render.js'); if (m && m.renderCfg) m.renderCfg(app); } catch (e) { }
                        app.state.lastLoadedRaw = txt;
                    } else
                    {
                        app.state.groups = app.parsePrivilegesXml(txt || '');
                        try { if (typeof renderGroups !== 'undefined') renderGroups(app); } catch (e) { }
                        try { await app.validateAll(); } catch (e) { }
                        app.state.lastLoadedRaw = txt;
                    }
                    return;
                }

                if (step3Visible)
                {
                    if (fileType === 'cfg')
                    {
                        app.state.cfgEntries = app.parseCfg(txt || '');
                        try { const m = await import('./render.js'); if (m && m.renderCfg) m.renderCfg(app); } catch (e) { }
                        app.state.lastLoadedRaw = txt;
                    } else
                    {
                        app.state.groups = app.parsePrivilegesXml(txt || '');
                        try { if (typeof renderGroups !== 'undefined') renderGroups(app); } catch (e) { }
                        try { await app.validateAll(); } catch (e) { }
                        app.state.lastLoadedRaw = txt;
                    }
                    app.setStep(2);
                    return;
                }
            }
        } catch (e) { }
    });

    applyFileTypeUI();

    const step1El = document.getElementById('step1');
    const fileTypeWrap = document.getElementById('fileTypeWrap');

    //! updateFileToggleVisibility - show/hide file type toggle based on context
    function updateFileToggleVisibility()
    {
        if (!fileTypeWrap || !step1El) return;

        const step2El = document.getElementById('step2');
        const step3El = document.getElementById('step3');
        const step1Visible = !step1El.classList.contains('d-none');
        const otherVisible = (step2El && !step2El.classList.contains('d-none')) || (step3El && !step3El.classList.contains('d-none'));
        const creds = app.state.ftpCredentials;
        const visible = step1Visible || (otherVisible && creds && creds.host && creds.user);
        fileTypeWrap.style.display = visible ? 'block' : 'none';
    }

    updateFileToggleVisibility();
    try { if (step1El) new MutationObserver(updateFileToggleVisibility).observe(step1El, { attributes: true, attributeFilter: ['class'] }); } catch (e) { }

    window.serverApp = app;

    const step1btn = document.getElementById('step1btn');
    const step2btn = document.getElementById('step2btn');
    const step3btn = document.getElementById('step3btn');

    step1btn?.addEventListener('click', async () =>
    {
        try { if (app.hasUnsavedChanges && app.hasUnsavedChanges()) { if (!(await showConfirm('You have unsaved changes. Going back will discard them. Continue?'))) return; } } catch (e) { }
        app.setStep(1);
    });

    step2btn?.addEventListener('click', () => { app.setStep(2); });
    step3btn?.addEventListener('click', () => { app.setStep(3); });

    const quickBox = document.getElementById('quickConnectionBox');
    const quickPriv = document.getElementById('quickLoadPrivBtn');
    const quickCfg = document.getElementById('quickLoadCfgBtn');
    const fileTypeEditFtpBtn = document.getElementById('fileTypeEditFtpBtn');

    //! updateQuickBox - show/hide quick FTP box based on saved creds
    function updateQuickBox()
    {
        try
        {
            const creds = app.state.ftpCredentials;
            const step2Visible = !document.getElementById('step2')?.classList.contains('d-none');
            if (creds && creds.host && creds.user && step2Visible)
            {
                if (quickBox) quickBox.classList.remove('d-none');
            } else
            {
                if (quickBox) quickBox.classList.add('d-none');
            }
        } catch (e) { }
    }

    quickPriv?.addEventListener('click', async () => { await quickDownload(app, 'privileges'); });
    quickCfg?.addEventListener('click', async () => { await quickDownload(app, 'cfg'); });

    const quickEdit = document.getElementById('quickEditCredsBtn');
    quickEdit?.addEventListener('click', () => { document.getElementById('ftpChangeBtn')?.click(); });

    if (fileTypeEditFtpBtn)
    {
        fileTypeEditFtpBtn.addEventListener('click', () => { document.getElementById('ftpChangeBtn')?.click(); });
    }

    updateQuickBox();

    try
    {
        const credsInit = app.state.ftpCredentials;
        const btnInit = document.getElementById('fileTypeEditFtpBtn');
        if (btnInit)
        {
            if (credsInit && credsInit.host && credsInit.user) btnInit.classList.remove('d-none');
            else btnInit.classList.add('d-none');
        }
    } catch (e) { }

    window.addEventListener('ftpCredsChanged', updateQuickBox);
    window.addEventListener('ftpCredsChanged', updateFileToggleVisibility);

    window.addEventListener('ftpCredsChanged', () =>
    {
        try
        {
            const creds = app.state.ftpCredentials;
            const btn = document.getElementById('fileTypeEditFtpBtn');
            if (btn)
            {
                if (creds && creds.host && creds.user)
                {
                    btn.classList.remove('d-none');
                    btn.textContent = 'Edit FTP';
                } else
                {
                    btn.classList.add('d-none');
                }
            }
        } catch (e) { }
    });

    window.addEventListener('ftpCredsChanged', () =>
    {
        try
        {
            const creds = app.state.ftpCredentials;
            const loadBtn = document.getElementById('loadFtpBtn');
            if (loadBtn) loadBtn.textContent = (creds && creds.host && creds.user) ? 'Edit FTP Connection' : 'Connect & Load';
        } catch (e) { }
    });

} catch (e)
{
    console.error('Boot error initializing ServerEditor:', e);
}
