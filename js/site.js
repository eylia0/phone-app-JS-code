// ==========================================================================
// SITE TAB: announcements, team & messages, documents/BIM, compliance,
// site details and (for managers) the linking code + permissions.
// ==========================================================================
import * as store from './store.js';

let nav = { switchPage: () => {}, onSiteChanged: () => {} };
let subBack = null;
let liveRerender = null;

export function initSiteUI(navApi) {
    nav = { ...nav, ...navApi };
    const backBtn = document.getElementById('sub-back');
    if (backBtn) backBtn.onclick = () => (subBack ? subBack() : openSiteHub());
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export function timeAgo(ts) {
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(ts).toLocaleDateString();
}

const initials = (name) => (name || '?').split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function showError(err) {
    alert(err?.message || String(err));
}

function rowCard({ act, icon, title, sub }) {
    return `
        <button class="list-card" data-act="${act}">
            <span class="round-icon soft emoji">${icon}</span>
            <span class="list-card-text"><strong>${title}</strong><small>${sub}</small></span>
            <svg class="chev"><use href="#i-chevron-right"/></svg>
        </button>`;
}

function roleTag(member) {
    return member?.role === 'manager'
        ? '<span class="tag tag-manager">Manager</span>'
        : `<span class="tag">${esc(store.getUser(member?.userId)?.trade || 'Worker')}</span>`;
}

// live: re-render automatically when new Sidekick data arrives (see refreshLiveSub)
export function openSub(title, render, back = openSiteHub, { live = false } = {}) {
    document.getElementById('sub-title').innerText = title;
    subBack = back;
    const body = document.getElementById('sub-body');
    const rerender = () => { body.innerHTML = ''; render(body, rerender); };
    liveRerender = live ? rerender : null;
    rerender();
    nav.switchPage('page-sub');
}

export function refreshLiveSub() {
    const page = document.getElementById('page-sub');
    if (liveRerender && page && !page.classList.contains('hidden')) liveRerender();
}

export async function shareCode(site) {
    const text = `Join ${site.name} on TradeLink with site code ${site.code}`;
    if (navigator.share) {
        try { await navigator.share({ title: 'TradeLink site code', text }); return; } catch (err) { if (err.name === 'AbortError') return; }
    }
    await copyText(site.code);
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        alert(`Copied "${text}" to clipboard.`);
    } catch {
        prompt('Copy this code:', text);
    }
}

// Data URLs can't be opened top-level in Chrome, so convert to a blob URL
async function openDocument(doc) {
    if (!doc.dataUrl) return alert('This file was too large to keep in offline demo storage, so only its name was saved.');
    const blob = await (await fetch(doc.dataUrl)).blob();
    window.open(URL.createObjectURL(blob), '_blank');
}

function readFile(file) {
    return new Promise((resolve, reject) => {
        if (file.size > store.MAX_STORED_FILE_BYTES) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

// --------------------------------------------------------------------------
// SITE HUB (the "Site" tab)
// --------------------------------------------------------------------------
export function openSiteHub() {
    renderSiteHub();
    nav.switchPage('page-site');
}

export function renderSiteHub() {
    const el = document.getElementById('site-hub-body');
    if (!el) return;
    const site = store.currentSite();
    if (!site) {
        el.innerHTML = `<div class="card"><p class="muted">You're not linked to a site. Join one with a site code to see announcements, team and compliance.</p></div>`;
        return;
    }
    const me = store.currentUser();
    const isMgr = store.isManager();
    const members = store.membersOf(site.id);
    const posts = store.listAnnouncements(site.id);
    const pending = store.listCompliance(site.id).filter(c => c.status === 'submitted').length;
    const docs = store.listDocuments(site.id);

    el.innerHTML = `
        <div class="card site-summary">
            <div>
                <small class="muted">Signed in as</small>
                <h3>${esc(me?.name)} ${isMgr ? '<span class="tag tag-manager">Site Manager</span>' : `<span class="tag">${esc(me?.trade || 'Worker')}</span>`}</h3>
                <p class="muted">${esc(site.name)} · ${esc(site.location)}</p>
            </div>
        </div>

        ${isMgr ? `
        <div class="card code-card">
            <small>Site linking code</small>
            <div class="code-display">${esc(site.code)}</div>
            <p class="muted">Share this code so workers can link to the site.</p>
            <div class="btn-row">
                <button class="btn btn-primary" data-act="share">Share Code</button>
                <button class="btn btn-ghost" data-act="copy">Copy</button>
            </div>
            <button class="text-action-link" data-act="regen">Generate a new code</button>
        </div>` : ''}

        <div class="settings-list">
            ${rowCard({ act: 'announce', icon: '📣', title: 'Announcements', sub: posts.length ? `Latest ${timeAgo(posts[0].createdAt)}` : 'No posts yet' })}
            ${rowCard({ act: 'team', icon: '👥', title: isMgr ? 'Team, Messages & Permissions' : 'Team & Messages', sub: `${members.length} ${members.length === 1 ? 'person' : 'people'} on site` })}
            ${store.can('viewDocuments') ? rowCard({ act: 'docs', icon: '📁', title: 'Documents & BIM', sub: `${docs.length} file${docs.length === 1 ? '' : 's'}` }) : ''}
            ${rowCard({ act: 'compliance', icon: '✅', title: 'Compliance', sub: pending ? `${pending} awaiting confirmation` : 'Nothing awaiting confirmation' })}
            ${rowCard({ act: 'details', icon: '🏗️', title: 'Site Details', sub: store.can('editSiteDetails') ? 'Review and edit' : 'Review' })}
        </div>`;

    el.querySelectorAll('[data-act]').forEach(btn => {
        btn.onclick = async () => {
            const act = btn.getAttribute('data-act');
            try {
                if (act === 'share') await shareCode(site);
                if (act === 'copy') await copyText(site.code);
                if (act === 'regen' && confirm('Generate a new code? The old code will stop working for new joins.')) {
                    store.regenerateCode(site.id);
                    renderSiteHub();
                    nav.onSiteChanged();
                }
                if (act === 'announce') openAnnouncements();
                if (act === 'team') openTeam();
                if (act === 'docs') openDocuments();
                if (act === 'compliance') openCompliance();
                if (act === 'details') openSiteDetails();
            } catch (err) { showError(err); }
        };
    });
}

// --------------------------------------------------------------------------
// ANNOUNCEMENTS
// --------------------------------------------------------------------------
export function openAnnouncements(back) {
    openSub('Announcements', (body, rerender) => {
        const site = store.currentSite();
        const me = store.getSession().userId;
        const posts = store.listAnnouncements(site.id);
        const members = store.membersOf(site.id);

        body.innerHTML = `
            ${store.can('postUpdates') ? `
            <div class="card servicenow-composer">
                <textarea id="announce-input" rows="3" placeholder="${store.isManager() ? 'Post an announcement to everyone on site...' : 'Post an update to the site...'}"></textarea>
                <button class="btn btn-primary" id="announce-post">Post</button>
            </div>` : `<p class="muted">Your site manager hasn't given you permission to post updates.</p>`}
            <div class="feed">
                ${posts.length ? posts.map(p => {
                    const author = store.getUser(p.authorId);
                    const member = members.find(m => m.userId === p.authorId);
                    const canDelete = store.isManager() || p.authorId === me;
                    return `
                    <div class="card feed-item ${member?.role === 'manager' ? 'is-manager' : ''}">
                        <div class="feed-head">
                            <span class="avatar">${esc(initials(author?.name))}</span>
                            <div class="feed-meta"><strong>${esc(author?.name || 'Former member')}</strong> ${roleTag(member)}<small>${timeAgo(p.createdAt)}</small></div>
                            ${canDelete ? `<button class="text-action-link" data-del="${p.id}">Remove</button>` : ''}
                        </div>
                        <p class="feed-text">${esc(p.text)}</p>
                    </div>`;
                }).join('') : '<p class="empty-stream-text">No announcements yet.</p>'}
            </div>`;

        body.querySelector('#announce-post')?.addEventListener('click', () => {
            const input = body.querySelector('#announce-input');
            if (!input.value.trim()) return;
            try { store.postAnnouncement(input.value); rerender(); nav.onSiteChanged(); } catch (err) { showError(err); }
        });
        body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
            if (!confirm('Remove this post?')) return;
            try { store.deleteAnnouncement(b.getAttribute('data-del')); rerender(); nav.onSiteChanged(); } catch (err) { showError(err); }
        });
    }, back);
}

// --------------------------------------------------------------------------
// TEAM, MESSAGES & PERMISSIONS
// --------------------------------------------------------------------------
function openTeam() {
    openSub(store.isManager() ? 'Team' : 'Team & Messages', (body) => {
        const site = store.currentSite();
        const me = store.getSession().userId;
        const others = store.membersOf(site.id).filter(m => m.userId !== me);

        body.innerHTML = others.length ? `<div class="settings-list">
            ${others.map(m => {
                const last = store.lastMessageWith(m.userId);
                const canMsg = store.canMessage(m.userId);
                return `
                <div class="list-card member-row">
                    <span class="avatar lg">${esc(initials(m.user.name))}</span>
                    <span class="list-card-text">
                        <strong>${esc(m.user.name)} ${roleTag(m)}</strong>
                        <small>${last ? esc((last.fromId === me ? 'You: ' : '') + last.text) : 'No messages yet'}</small>
                    </span>
                    <span class="member-actions">
                        ${canMsg ? `<button class="mini-btn" data-chat="${m.userId}">Message</button>` : ''}
                        ${store.isManager() && m.role !== 'manager' ? `<button class="mini-btn ghost" data-perm="${m.userId}">Permissions</button>` : ''}
                    </span>
                </div>`;
            }).join('')}
        </div>` : `<div class="card"><p class="muted">Nobody else has joined yet.${store.isManager() ? ' Share the site code from the Site tab to invite workers.' : ''}</p></div>`;

        body.querySelectorAll('[data-chat]').forEach(b => b.onclick = () => openChat(b.getAttribute('data-chat')));
        body.querySelectorAll('[data-perm]').forEach(b => b.onclick = () => openPermissions(b.getAttribute('data-perm')));
    });
}

function openChat(otherId) {
    const other = store.getUser(otherId);
    openSub(other?.name || 'Message', (body, rerender) => {
        const me = store.getSession().userId;
        const thread = store.conversation(otherId);
        body.innerHTML = `
            <div class="chat-thread">
                ${thread.length ? thread.map(m => `
                    <div class="bubble ${m.fromId === me ? 'mine' : ''}">
                        <p>${esc(m.text)}</p><small>${timeAgo(m.createdAt)}</small>
                    </div>`).join('') : '<p class="empty-stream-text">Start the conversation.</p>'}
            </div>
            <div class="chat-composer">
                <input type="text" id="chat-input" placeholder="Message ${esc(other?.name)}..." autocomplete="off">
                <button class="btn btn-primary" id="chat-send">Send</button>
            </div>`;
        const input = body.querySelector('#chat-input');
        const send = () => {
            if (!input.value.trim()) return;
            try { store.sendMessage(otherId, input.value); rerender(); body.querySelector('#chat-input')?.focus(); } catch (err) { showError(err); }
        };
        body.querySelector('#chat-send').onclick = send;
        input.onkeydown = (e) => { if (e.key === 'Enter') send(); };
        const threadEl = body.querySelector('.chat-thread');
        threadEl.scrollTop = threadEl.scrollHeight;
    }, openTeam);
}

function openPermissions(userId) {
    const user = store.getUser(userId);
    openSub('Permissions', (body, rerender) => {
        const site = store.currentSite();
        const m = store.membership(site.id, userId);
        if (!m) { openTeam(); return; }
        body.innerHTML = `
            <div class="card site-summary">
                <span class="avatar lg">${esc(initials(user.name))}</span>
                <div><h3>${esc(user.name)}</h3><p class="muted">${esc(user.trade || 'Worker')} · joined ${timeAgo(m.joinedAt)}</p></div>
            </div>
            <div class="card toggle-list">
                ${store.PERMISSIONS.map(p => `
                    <label class="toggle-row">
                        <span>${p.label}</span>
                        <input type="checkbox" class="switch" data-key="${p.key}" ${m.permissions?.[p.key] ? 'checked' : ''}>
                    </label>`).join('')}
            </div>
            <button class="btn btn-danger-ghost" id="remove-member">Remove from site</button>`;

        body.querySelectorAll('.switch').forEach(sw => sw.onchange = () => {
            try { store.setPermission(site.id, userId, sw.getAttribute('data-key'), sw.checked); } catch (err) { showError(err); rerender(); }
        });
        body.querySelector('#remove-member').onclick = () => {
            if (!confirm(`Remove ${user.name} from ${site.name}?`)) return;
            try { store.removeMember(site.id, userId); openTeam(); } catch (err) { showError(err); }
        };
    }, openTeam);
}

// --------------------------------------------------------------------------
// DOCUMENTS & BIM
// --------------------------------------------------------------------------
export function openDocuments() {
    openSub('Documents & BIM', (body, rerender) => {
        const site = store.currentSite();
        const me = store.getSession().userId;
        const canUpload = store.can('uploadDocuments');
        const bim = store.listDocuments(site.id, 'bim')[0];
        const docs = store.listDocuments(site.id, 'document');

        const docRow = (d) => `
            <div class="list-card doc-row">
                <span class="round-icon soft emoji">${d.type?.startsWith('image/') ? '🖼️' : d.type === 'application/pdf' ? '📄' : '📎'}</span>
                <span class="list-card-text">
                    <strong>${esc(d.name)}</strong>
                    <small>${formatSize(d.size)} · ${esc(store.getUser(d.uploadedBy)?.name || '')} · ${timeAgo(d.createdAt)}${d.dataUrl ? '' : ' · name only'}</small>
                </span>
                <span class="member-actions">
                    <button class="mini-btn" data-open="${d.id}">Open</button>
                    ${store.isManager() || d.uploadedBy === me ? `<button class="mini-btn ghost" data-remove="${d.id}">Remove</button>` : ''}
                </span>
            </div>`;

        body.innerHTML = `
            <h4 class="section-title">BIM / Floor Plan</h4>
            <div class="card bim-card">
                ${bim ? `
                    ${bim.dataUrl && bim.type?.startsWith('image/') ? `<img class="bim-preview" src="${bim.dataUrl}" alt="Site plan">` : `<div class="bim-placeholder">📐 ${esc(bim.name)}</div>`}
                    <p class="muted">${esc(bim.name)} · ${formatSize(bim.size)} · uploaded ${timeAgo(bim.createdAt)}</p>
                    ${bim.dataUrl && bim.type?.startsWith('image/')
                        ? '<button class="btn btn-primary" data-pick-points>Pick Points on Plan</button>'
                        : '<p class="subtle-hint">Point picking works on image plans (PNG/JPG). Export a plan view from your BIM tool to use it.</p>'}
                    <div class="btn-row">
                        <button class="btn btn-ghost" data-open="${bim.id}">Open</button>
                        ${canUpload ? '<button class="btn btn-ghost" data-upload="bim">Replace</button>' : ''}
                    </div>`
                : `<p class="muted">No BIM model or floor plan connected yet.</p>
                   ${canUpload ? '<button class="btn btn-primary" data-upload="bim">Connect BIM / Plan</button>' : ''}`}
            </div>

            <div class="history-title-row">
                <h4 class="section-title">Site Documents</h4>
                ${canUpload ? '<button class="link-btn small" data-upload="document">+ Add document</button>' : ''}
            </div>
            <div class="settings-list">
                ${docs.length ? docs.map(docRow).join('') : '<p class="empty-stream-text">No documents uploaded yet.</p>'}
            </div>
            <input type="file" id="doc-file-input" class="hidden">`;

        const fileInput = body.querySelector('#doc-file-input');
        let uploadKind = 'document';
        body.querySelectorAll('[data-upload]').forEach(b => b.onclick = () => {
            uploadKind = b.getAttribute('data-upload');
            fileInput.accept = uploadKind === 'bim' ? '.ifc,.rvt,.dwg,.pdf,image/*' : '';
            fileInput.value = '';
            fileInput.click();
        });
        fileInput.onchange = async () => {
            const file = fileInput.files[0];
            if (!file) return;
            try {
                const dataUrl = await readFile(file);
                if (!dataUrl) alert(`"${file.name}" is over ${formatSize(store.MAX_STORED_FILE_BYTES)}, so only its name is kept in this offline demo.`);
                store.addDocument({ name: file.name, type: file.type, size: file.size, dataUrl, kind: uploadKind });
                rerender();
            } catch (err) { showError(err); }
        };
        body.querySelector('[data-pick-points]')?.addEventListener('click', () => nav.openPlan?.(openDocuments));
        const all = [...docs, ...(bim ? [bim] : [])];
        body.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openDocument(all.find(d => d.id === b.getAttribute('data-open'))));
        body.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => {
            if (!confirm('Remove this document?')) return;
            try { store.removeDocument(b.getAttribute('data-remove')); rerender(); } catch (err) { showError(err); }
        });
    });
}

// --------------------------------------------------------------------------
// COMPLIANCE
// --------------------------------------------------------------------------
const STATUS_LABEL = { submitted: 'Awaiting confirmation', confirmed: 'Confirmed', changes: 'Changes requested' };

function openCompliance() {
    openSub('Compliance', (body, rerender) => {
        const site = store.currentSite();
        const me = store.currentUser();
        const items = store.listCompliance(site.id);
        const defaultTrade = store.TRADES.includes(me?.trade) ? me.trade : 'General';

        body.innerHTML = `
            ${store.can('submitCompliance') ? `
            <div class="card stack">
                <h4 class="form-section-label">Submit compliance</h4>
                <div class="dual-input-grid">
                    <div class="form-group">
                        <label>Trade</label>
                        <select id="comp-trade">${store.TRADES.map(t => `<option ${t === defaultTrade ? 'selected' : ''}>${t}</option>`).join('')}</select>
                    </div>
                    <div class="form-group">
                        <label>Template</label>
                        <select id="comp-template"></select>
                    </div>
                </div>
                <div class="form-group">
                    <label>Item</label>
                    <input type="text" id="comp-title" placeholder="What is being signed off?">
                </div>
                <div class="form-group">
                    <label>Notes / location</label>
                    <textarea id="comp-note" rows="2" placeholder="e.g. Unit 204, all fittings checked"></textarea>
                </div>
                <button class="btn btn-primary" id="comp-submit">Submit for confirmation</button>
            </div>` : ''}

            <div class="feed">
                ${items.length ? items.map(c => {
                    const by = store.getUser(c.submittedBy);
                    const lastReview = c.reviews[c.reviews.length - 1];
                    const reviewer = lastReview && store.getUser(lastReview.userId);
                    const canReview = c.status === 'submitted' && store.can('confirmCompliance') && c.submittedBy !== me?.id;
                    const canResubmit = c.status === 'changes' && c.submittedBy === me?.id;
                    return `
                    <div class="card feed-item">
                        <div class="comp-head">
                            <span class="tag">${esc(c.trade)}</span>
                            <span class="pill pill-${c.status}">${STATUS_LABEL[c.status]}</span>
                        </div>
                        <strong class="comp-title">${esc(c.title)}</strong>
                        ${c.note ? `<p class="feed-text">${esc(c.note)}</p>` : ''}
                        <small class="muted">Submitted by ${esc(by?.name || 'former member')} · ${timeAgo(c.submittedAt)}</small>
                        ${lastReview ? `<small class="muted">${lastReview.decision === 'confirm' ? 'Confirmed' : 'Changes requested'} by ${esc(reviewer?.name || '')} · ${timeAgo(lastReview.at)}${lastReview.note ? ` — "${esc(lastReview.note)}"` : ''}</small>` : ''}
                        ${canReview ? `<div class="btn-row">
                            <button class="btn btn-primary" data-confirm="${c.id}">Confirm</button>
                            <button class="btn btn-ghost" data-changes="${c.id}">Request changes</button>
                        </div>` : ''}
                        ${canResubmit ? `<button class="btn btn-ghost" data-resubmit="${c.id}">Mark fixed & resubmit</button>` : ''}
                    </div>`;
                }).join('') : '<p class="empty-stream-text">No compliance items yet.</p>'}
            </div>`;

        // Template picker fills the item field
        const tradeSel = body.querySelector('#comp-trade');
        const tplSel = body.querySelector('#comp-template');
        const titleInput = body.querySelector('#comp-title');
        const fillTemplates = () => {
            if (!tplSel) return;
            tplSel.innerHTML = `<option value="">Custom item</option>` +
                (store.COMPLIANCE_TEMPLATES[tradeSel.value] || []).map(t => `<option>${esc(t)}</option>`).join('');
        };
        if (tradeSel) {
            fillTemplates();
            tradeSel.onchange = fillTemplates;
            tplSel.onchange = () => { if (tplSel.value) titleInput.value = tplSel.value; };
        }

        body.querySelector('#comp-submit')?.addEventListener('click', () => {
            try {
                store.submitCompliance({ title: titleInput.value, trade: tradeSel.value, note: body.querySelector('#comp-note').value });
                rerender();
                nav.onSiteChanged();
            } catch (err) { showError(err); }
        });
        body.querySelectorAll('[data-confirm]').forEach(b => b.onclick = () => {
            try { store.reviewCompliance(b.getAttribute('data-confirm'), 'confirm'); rerender(); nav.onSiteChanged(); } catch (err) { showError(err); }
        });
        body.querySelectorAll('[data-changes]').forEach(b => b.onclick = () => {
            const note = prompt('What needs to change?');
            if (note === null) return;
            try { store.reviewCompliance(b.getAttribute('data-changes'), 'changes', note); rerender(); nav.onSiteChanged(); } catch (err) { showError(err); }
        });
        body.querySelectorAll('[data-resubmit]').forEach(b => b.onclick = () => {
            const note = prompt('Describe the fix (optional):') ?? '';
            try { store.resubmitCompliance(b.getAttribute('data-resubmit'), note); rerender(); nav.onSiteChanged(); } catch (err) { showError(err); }
        });
    });
}

// --------------------------------------------------------------------------
// SITE DETAILS (review / edit)
// --------------------------------------------------------------------------
function openSiteDetails() {
    openSub('Site Details', (body) => {
        const site = store.currentSite();
        const editable = store.can('editSiteDetails');
        const fields = [
            { key: 'name', label: 'Site Name' },
            { key: 'location', label: 'Block / Level' },
            { key: 'address', label: 'Address' },
            { key: 'client', label: 'Client / Builder' },
            { key: 'startDate', label: 'Start Date', type: 'date' },
            { key: 'description', label: 'Scope / Description', multiline: true }
        ];
        const manager = store.getUser(site.managerId);

        body.innerHTML = `
            <div class="card stack">
                ${fields.map(f => `
                    <div class="form-group">
                        <label>${f.label}</label>
                        ${f.multiline
                            ? `<textarea data-field="${f.key}" rows="3" ${editable ? '' : 'readonly'}>${esc(site[f.key])}</textarea>`
                            : `<input type="${f.type || 'text'}" data-field="${f.key}" value="${esc(site[f.key])}" ${editable ? '' : 'readonly'}>`}
                    </div>`).join('')}
                <p class="muted">Site manager: ${esc(manager?.name || '')}</p>
                ${editable ? '<button class="btn btn-primary" id="save-site-details">Save Changes</button>' : ''}
            </div>`;

        body.querySelector('#save-site-details')?.addEventListener('click', () => {
            const patch = {};
            body.querySelectorAll('[data-field]').forEach(inp => { patch[inp.getAttribute('data-field')] = inp.value; });
            if (!patch.name.trim()) return alert('Site name cannot be empty.');
            try {
                store.updateSite(site.id, patch);
                nav.onSiteChanged();
                alert('Site details saved.');
            } catch (err) { showError(err); }
        });
    });
}

// --------------------------------------------------------------------------
// MANAGER: SITES LIST
// --------------------------------------------------------------------------
export function renderManagerSites() {
    const el = document.getElementById('manager-sites-body');
    const me = store.currentUser();
    if (!el || !me) return;
    const sites = store.sitesManagedBy(me.id);
    document.getElementById('manager-greeting').innerText = `Hi ${me.name.split(' ')[0]}`;

    el.innerHTML = sites.length ? sites.map(s => `
        <button class="list-card" data-site="${s.id}">
            <span class="round-icon soft"><svg><use href="#i-building"/></svg></span>
            <span class="list-card-text">
                <strong>${esc(s.name)}</strong>
                <small>${esc(s.location)} · ${store.membersOf(s.id).length} people · code ${esc(s.code)}</small>
            </span>
            <svg class="chev"><use href="#i-chevron-right"/></svg>
        </button>`).join('')
        : '<div class="card"><p class="muted">You have no sites yet. Create your first site profile below.</p></div>';

    el.querySelectorAll('[data-site]').forEach(b => b.onclick = () => {
        store.selectManagedSite(b.getAttribute('data-site'));
        nav.onSiteChanged();
        nav.switchPage('page-trade-grid');
    });
}

// --------------------------------------------------------------------------
// MORE TAB: account + demo account switcher
// --------------------------------------------------------------------------
export function renderAccountCard() {
    const el = document.getElementById('account-card');
    if (!el) return;
    const s = store.getSession();
    const user = store.currentUser();
    const site = store.currentSite();
    const roleLabel = { manager: 'Site Manager', linked: 'Linked Worker', standard: 'Standard User' }[s?.role] || 'Not signed in';
    const name = user?.name || (s?.role === 'standard' ? 'Standard user' : 'Guest');
    const siteName = site?.name || s?.localSite?.name || 'No site selected';
    el.innerHTML = `
        <span class="avatar lg">${esc(initials(name))}</span>
        <span class="list-card-text">
            <strong>${esc(name)}</strong>
            <small>${roleLabel} · ${esc(siteName)}</small>
        </span>`;
}

export function openAccountSwitcher() {
    openSub('Switch Account', (body) => {
        const s = store.getSession();
        const accounts = store.deviceAccounts();
        body.innerHTML = `
            <p class="muted">Demo only: switch between accounts on this device to test manager and worker views.</p>
            <div class="settings-list">
                ${accounts.flatMap(a => a.memberships.filter(m => m.site).map(m => {
                    const active = s?.userId === a.user.id && s?.siteId === m.siteId;
                    return `
                    <button class="list-card ${active ? 'is-active' : ''}" data-user="${a.user.id}" data-site="${m.siteId}">
                        <span class="avatar lg">${esc(initials(a.user.name))}</span>
                        <span class="list-card-text">
                            <strong>${esc(a.user.name)} ${m.role === 'manager' ? '<span class="tag tag-manager">Manager</span>' : `<span class="tag">${esc(a.user.trade || 'Worker')}</span>`}</strong>
                            <small>${esc(m.site.name)}${active ? ' · current' : ''}</small>
                        </span>
                    </button>`;
                })).join('')}
            </div>`;
        body.querySelectorAll('[data-user]').forEach(b => b.onclick = () => {
            store.signInAs(b.getAttribute('data-user'), b.getAttribute('data-site'));
            nav.onSiteChanged();
            nav.switchPage('page-trade-grid');
        });
    }, () => nav.switchPage('page-more'));
}
