
//! Escape HTML for safe insertion into the DOM
//! \param s - input string
function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

//! showToast - show a toast notification
//! \param message - text message to display
//! \param actions - optional action buttons array
//! \param opts - options (type etc)
export function showToast(message, actions, opts)
{
    const c = document.getElementById('toastContainer'); if (!c) return;
    const card = document.createElement('div'); card.className = 'toast-card';
    const type = opts && opts.type ? opts.type : null; if (type === 'success') card.classList.add('toast-card-success');
    card.innerHTML = `<div class="toast-message">${escapeHtml(message)}</div>`;
    if (Array.isArray(actions) && actions.length)
    {
        card.classList.add('toast-card-persistent'); const awrap = document.createElement('div'); awrap.className = 'toast-actions';
        actions.forEach(act => { const b = document.createElement('button'); b.className = act.style || 'btn btn-sm'; b.textContent = act.label || 'OK'; b.addEventListener('click', () => { try { act.onClick && act.onClick(); } catch (e) { }; card.remove(); }); awrap.appendChild(b); });
        card.appendChild(awrap);
    } else { setTimeout(() => card.remove(), 3500); }
    c.appendChild(card);
}

//! showConfirm - show a confirm-style toast and return promise
//! \param message - confirmation message
//! \param opts - options
export function showConfirm(message, opts)
{
    return new Promise((resolve) =>
    {
        try
        {
            showToast(message, [
                { label: 'Yes', style: 'btn btn-sm btn-primary', onClick: () => { resolve(true); } },
                { label: 'No', style: 'btn btn-sm btn-outline-secondary', onClick: () => { resolve(false); } }
            ], Object.assign({ type: 'warning' }, opts || {}));
        } catch (e) { resolve(false); }
    });
}

//! showProfileModal - display a simple modal to open given steam profile
//! \param steamid - steamid64 string
export function showProfileModal(steamid)
{
    let modal = document.getElementById('steamProfileModal');
    if (!modal)
    {
        modal = document.createElement('div'); modal.id = 'steamProfileModal'; modal.className = 'simple-modal';
        modal.innerHTML = `
        <div class="simple-modal-backdrop"></div>
        <div class="simple-modal-card">
            <button id="closeModalBtn" class="modal-close-btn" aria-label="Close">×</button>
            <div class="simple-modal-body" id="steamProfileBody"></div>
            <div class="simple-modal-actions">
                <button id="openSteamClientBtn" class="btn btn-primary">Open in Steam</button>
                <button id="openBrowserBtn" class="btn btn-outline-secondary">Open in Browser</button>
            </div>
        </div>
    `;
        document.body.appendChild(modal);
        document.getElementById('closeModalBtn').addEventListener('click', () => modal.remove());
        document.getElementById('openSteamClientBtn').addEventListener('click', () =>
        {
            const url = `steam://openurl/https://steamcommunity.com/profiles/${encodeURIComponent(steamid)}`;
            try
            {
                // Use an anchor click to invoke protocol handlers without creating about:blank
                const a = document.createElement('a');
                a.href = url; a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => { try { a.remove(); } catch (e) { } }, 1000);
            } catch (e) { showToast('Failed to open Steam client'); }
            modal.remove();
        });
        document.getElementById('openBrowserBtn').addEventListener('click', () =>
        {
            const url = `https://steamcommunity.com/profiles/${encodeURIComponent(steamid)}`;
            const w = window.open(url, '_blank'); if (!w) showToast('Popup blocked — click link: ' + url); modal.remove();
        });
    }
    const body = document.getElementById('steamProfileBody'); if (body) body.innerHTML = `<div style="text-align:center;">Open Steam profile for <strong>${escapeHtml(steamid)}</strong>?</div>`;
    modal.style.display = 'block';
}

export { escapeHtml };
