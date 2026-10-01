// ==========================================================================
// JOB DATA: Sidekick captures (time + location stamped), Sidekick console
// with simulator, and the auto quote builder. Lives in the Notes tab.
// ==========================================================================
import * as store from './store.js';
import * as sidekick from './sidekick.js';
import { getFix, mapsLink } from './geo.js';
import { openSub, refreshLiveSub, esc, timeAgo } from './site.js';
import { sendNextPoint, addSitePoint } from './plan.js';

const money = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
const GST_RATE = 0.1;

let nav = { switchPage: () => {} };

// --------------------------------------------------------------------------
// Toast
// --------------------------------------------------------------------------
let toastTimer = null;
export function toast(message) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function dataChanged() {
    renderJobPanels();
    refreshLiveSub();
}

// --------------------------------------------------------------------------
// Incoming Sidekick messages
// --------------------------------------------------------------------------
export function initJobData(navApi) {
    nav = { ...nav, ...navApi };

    sidekick.onMessage(async (msg) => {
        try {
            if (msg.type === 'battery') {
                const pct = document.querySelector('#tool-card .battery-pct');
                const fill = document.querySelector('#tool-card .battery-fill');
                if (pct) pct.innerText = `${msg.pct}%`;
                if (fill) fill.style.width = `${msg.pct}%`;
                return;
            }
            if (msg.type === 'request' && msg.what === 'NEXT') {
                const next = await sendNextPoint();
                toast(next ? `Sent point ${next.n} (${next.label}) to Sidekick` : 'No more points to set out');
                dataChanged();
                return;
            }

            const geo = await getFix();
            const source = msg.origin === 'simulator' ? 'simulator' : 'sidekick';

            if (msg.type === 'measurement') {
                store.addCapture({ type: 'measurement', valueMm: msg.mm, label: msg.label, source, geo });
                toast(`📏 ${formatMm(msg.mm)} received from Sidekick`);
            } else if (msg.type === 'note') {
                store.addCapture({ type: 'note', text: msg.text, source, geo });
                toast('🗒️ Note received from Sidekick');
            } else if (msg.type === 'mark') {
                const point = store.markPlanPoint(msg.n, geo);
                toast(point ? `📍 Point ${point.n} marked on site` : `Point ${msg.n} not found on the active plan`);
            } else if (msg.type === 'site-point') {
                const point = addSitePoint(msg, geo);
                if (point) toast(`📍 Site point ${point.n} added to the plan`);
                else {
                    store.addCapture({ type: 'note', text: `Site point at x ${msg.xCm} cm, y ${msg.yCm} cm${msg.label ? ` (${msg.label})` : ''}`, source, geo });
                    toast('📍 Site point saved (no plan connected)');
                }
            }
            dataChanged();
        } catch (err) {
            toast(err.message);
        }
    });

    sidekick.onLog(() => refreshLiveSub());

    document.querySelectorAll('#notes-tabs [data-seg]').forEach(btn => {
        btn.onclick = () => showSegment(btn.getAttribute('data-seg'));
    });
}

// Trade tools call this when a layout should count towards a quote
export async function recordLayout({ trade, item, count, detail }) {
    if (!count) return alert('Nothing to add yet: generate a layout first.');
    try {
        const geo = await getFix();
        store.addCapture({ type: 'layout', trade, item, count, detail, source: 'app', geo });
        toast(`Added ${count} × ${ITEM_LABEL[item] || item} to job data for quoting`);
        dataChanged();
    } catch (err) {
        alert(err.message);
    }
}

const ITEM_LABEL = { downlight: 'downlights', switchbox: 'switch/outlet boxes', 'plumbing-point': 'plumbing points' };

function formatMm(mm) {
    return mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${Math.round(mm)} mm`;
}

// --------------------------------------------------------------------------
// Notes tab segments
// --------------------------------------------------------------------------
export function showSegment(id) {
    document.querySelectorAll('#notes-tabs [data-seg]').forEach(b => b.classList.toggle('active', b.getAttribute('data-seg') === id));
    document.querySelectorAll('.seg-panel').forEach(p => p.classList.toggle('hidden', p.id !== id));
    renderJobPanels();
}

export function renderJobPanels() {
    const captures = document.getElementById('seg-captures');
    const quotes = document.getElementById('seg-quotes');
    if (captures && !captures.classList.contains('hidden')) renderCaptures(captures);
    if (quotes && !quotes.classList.contains('hidden')) renderQuotes(quotes);
}

// --------------------------------------------------------------------------
// Captures list
// --------------------------------------------------------------------------
function geoLine(geo) {
    return geo
        ? `<a href="${mapsLink(geo)}" target="_blank" rel="noopener">📍 ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)} (±${geo.acc} m)</a>`
        : '<span>📍 Location unavailable</span>';
}

function renderCaptures(el) {
    if (!store.workspaceKey()) {
        el.innerHTML = '<div class="card"><p class="muted">Pick a site first.</p></div>';
        return;
    }
    const status = sidekick.channelStatus();
    const items = store.listCaptures();
    const sourceTag = { sidekick: 'Sidekick', simulator: 'Simulator', manual: 'Manual', app: 'App' };

    el.innerHTML = `
        <button class="list-card" id="open-console">
            <span class="round-icon soft"><svg><use href="#i-tool"/></svg></span>
            <span class="list-card-text">
                <strong>Sidekick Console</strong>
                <small>Receive ${status.receive ? 'on' : 'off'} · Commands ${status.command ? 'on' : 'off'}${status.simulator ? ' · Simulator on' : ''}</small>
            </span>
            <svg class="chev"><use href="#i-chevron-right"/></svg>
        </button>

        <div class="card stack">
            <h4 class="form-section-label">Add a measurement manually</h4>
            <div class="manual-row">
                <div class="unit-field"><input type="number" id="manual-mm" placeholder="1250" inputmode="decimal"><span>mm</span></div>
                <input type="text" id="manual-label" class="plain-input" placeholder="Label (optional)">
            </div>
            <button class="btn btn-ghost" id="manual-add">Save with time &amp; location</button>
        </div>

        <h4 class="section-title">Captured on site (${items.length})</h4>
        <div class="feed">
            ${items.length ? items.map(c => {
                const user = store.getUser(c.userId);
                const icon = { measurement: '📏', note: '🗒️', layout: c.trade === 'Plumbing' ? '🚰' : '💡' }[c.type] || '•';
                const main = c.type === 'measurement'
                    ? `<strong class="cap-value">${formatMm(c.valueMm)}</strong> ${c.label ? `<span>${esc(c.label)}</span>` : ''}`
                    : c.type === 'layout'
                        ? `<strong>${c.count} × ${esc(ITEM_LABEL[c.item] || c.item)}</strong> <span>${esc(c.detail || '')}</span>`
                        : `<span>${esc(c.text)}</span>`;
                return `
                <div class="card feed-item capture">
                    <div class="cap-head">
                        <span class="cap-icon">${icon}</span>
                        <div class="cap-main">${main}</div>
                        <button class="text-action-link" data-del-cap="${c.id}">Delete</button>
                    </div>
                    <div class="cap-meta">
                        <span class="tag">${sourceTag[c.source] || c.source}</span>
                        <span>🕒 ${new Date(c.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                        ${user ? `<span>👤 ${esc(user.name)}</span>` : ''}
                        ${geoLine(c.geo)}
                    </div>
                </div>`;
            }).join('') : '<p class="empty-stream-text">Nothing captured yet. Measurements and notes from your Sidekick appear here.</p>'}
        </div>`;

    el.querySelector('#open-console').onclick = openConsole;
    el.querySelector('#manual-add').onclick = async () => {
        const mm = Number.parseFloat(el.querySelector('#manual-mm').value);
        if (!(mm > 0)) return alert('Enter a measurement in mm.');
        const label = el.querySelector('#manual-label').value.trim();
        const geo = await getFix();
        store.addCapture({ type: 'measurement', valueMm: mm, label, source: 'manual', geo });
        renderCaptures(el);
    };
    el.querySelectorAll('[data-del-cap]').forEach(b => b.onclick = () => {
        if (!confirm('Delete this capture?')) return;
        store.removeCapture(b.getAttribute('data-del-cap'));
        renderCaptures(el);
    });
}

// --------------------------------------------------------------------------
// Sidekick console (live log + simulator)
// --------------------------------------------------------------------------
function openConsole() {
    openSub('Sidekick Console', (body, rerender) => {
        const status = sidekick.channelStatus();
        const plan = store.activePlan();
        const sentPoint = plan && store.listPlanPoints(plan.id).find(p => p.status === 'sent');
        const samples = [
            { label: 'Measurement', line: `MEAS,${Math.round(800 + Math.random() * 3200)},Wall run` },
            { label: 'Note', line: 'NOTE,Noggin needed above door frame' },
            { label: 'Battery 76%', line: 'BATT,76' },
            { label: 'Request next point', line: 'REQ,NEXT' },
            { label: sentPoint ? `Mark point ${sentPoint.n}` : 'Mark point 1', line: `MARK,${sentPoint ? sentPoint.n : 1}` },
            { label: 'New site point', line: 'PTNEW,250,180,Riser' }
        ];

        body.innerHTML = `
            <div class="card stack">
                <div class="channel-row"><span>Receive (2A57)</span><span class="pill ${status.receive ? 'pill-confirmed' : 'pill-changes'}">${status.receive ? 'Connected' : 'Not available'}</span></div>
                <div class="channel-row"><span>Commands (2A58)</span><span class="pill ${status.command ? 'pill-confirmed' : 'pill-changes'}">${status.command ? 'Connected' : 'Not available'}</span></div>
                <label class="toggle-row plain">
                    <span>Simulator: send without a device</span>
                    <input type="checkbox" class="switch" id="sim-toggle" ${status.simulator ? 'checked' : ''}>
                </label>
            </div>

            <h4 class="section-title">Simulate a message from the Sidekick</h4>
            <div class="chip-grid">
                ${samples.map(s => `<button class="chip-btn" data-sim="${esc(s.line)}">${esc(s.label)}</button>`).join('')}
            </div>
            <div class="chat-composer static">
                <input type="text" id="sim-line" placeholder="e.g. MEAS,1500,Hallway" autocomplete="off">
                <button class="btn btn-primary" id="sim-send">Inject</button>
            </div>

            <h4 class="section-title">Log</h4>
            <div class="console-log">
                ${sidekick.getLog().map(l => `
                    <div class="log-line log-${l.dir}">
                        <span class="log-dir">${l.dir === 'rx' ? '⬇ RX' : l.dir === 'tx' ? '⬆ TX' : '• SYS'}</span>
                        <code>${esc(l.text)}</code>
                        <small>${new Date(l.at).toLocaleTimeString()}${l.origin ? ` · ${esc(l.origin)}` : ''}</small>
                    </div>`).join('') || '<p class="empty-stream-text">No traffic yet.</p>'}
            </div>`;

        body.querySelector('#sim-toggle').onchange = (e) => { sidekick.setSimulator(e.target.checked); rerender(); };
        body.querySelectorAll('[data-sim]').forEach(b => b.onclick = () => sidekick.simulateIncoming(b.getAttribute('data-sim')));
        body.querySelector('#sim-send').onclick = () => {
            const line = body.querySelector('#sim-line').value.trim();
            if (line) sidekick.simulateIncoming(line);
        };
    }, () => { nav.switchPage('page-notes'); renderJobPanels(); }, { live: true });
}

// --------------------------------------------------------------------------
// Quotes
// --------------------------------------------------------------------------
function quoteTotals(q) {
    const subtotal = q.lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
    const gst = q.gst ? subtotal * GST_RATE : 0;
    return { subtotal, gst, total: subtotal + gst };
}

function currentSiteName() {
    return store.currentSite()?.name || store.getSession()?.localSite?.name || '';
}

// Builds quote lines from layouts and Sidekick measurements on this job
export function buildAutoLines() {
    const r = store.getRates();
    const layouts = store.listCaptures('layout');
    const measurements = store.listCaptures('measurement');
    const total = (item) => layouts.filter(l => l.item === item).reduce((sum, l) => sum + l.count, 0);
    const downlights = total('downlight');
    const boxes = total('switchbox');
    const plumbing = total('plumbing-point');
    const metres = measurements.reduce((sum, m) => sum + m.valueMm, 0) / 1000;
    const lines = [];

    if (downlights) lines.push({ desc: 'Supply & install LED downlights', qty: downlights, unit: 'ea', rate: r.downlight });
    if (boxes) lines.push({ desc: 'Install switch / outlet boxes', qty: boxes, unit: 'ea', rate: r.switchbox });
    if (plumbing) lines.push({ desc: 'Plumbing rough-in points', qty: plumbing, unit: 'ea', rate: r.plumbingPoint });
    if (metres > 0) lines.push({ desc: `Cable / pipe runs (${measurements.length} measurement${measurements.length === 1 ? '' : 's'})`, qty: +metres.toFixed(1), unit: 'm', rate: r.perMetre });

    // Rough labour estimate: 0.5h per downlight, 0.4h per box, 1.5h per plumbing point
    const hours = downlights * 0.5 + boxes * 0.4 + plumbing * 1.5;
    if (hours > 0) lines.push({ desc: 'Labour (estimated)', qty: Math.max(1, Math.ceil(hours * 2) / 2), unit: 'hr', rate: r.labourHour });
    lines.push({ desc: 'Call-out / site attendance', qty: 1, unit: 'ea', rate: r.callout });
    return lines;
}

function renderQuotes(el) {
    if (!store.workspaceKey()) {
        el.innerHTML = '<div class="card"><p class="muted">Pick a site first.</p></div>';
        return;
    }
    const quotes = store.listQuotes();
    const layouts = store.listCaptures('layout').length;
    const measurements = store.listCaptures('measurement').length;

    el.innerHTML = `
        <button class="action-card primary compact" id="new-quote">
            <span class="action-icon emoji-lg">🧾</span>
            <span class="action-text">
                <strong>Generate Quote</strong>
                <small>From ${layouts} layout${layouts === 1 ? '' : 's'} and ${measurements} measurement${measurements === 1 ? '' : 's'} on this job.</small>
            </span>
            <svg class="chev"><use href="#i-chevron-right"/></svg>
        </button>
        <h4 class="section-title">Saved quotes</h4>
        <div class="settings-list">
            ${quotes.length ? quotes.map(q => `
                <button class="list-card" data-quote="${q.id}">
                    <span class="round-icon soft emoji">🧾</span>
                    <span class="list-card-text">
                        <strong>${esc(q.number)} · ${esc(q.client || 'No client')}</strong>
                        <small>${money.format(quoteTotals(q).total)} · updated ${timeAgo(q.updatedAt)}</small>
                    </span>
                    <svg class="chev"><use href="#i-chevron-right"/></svg>
                </button>`).join('') : '<p class="empty-stream-text">No quotes yet.</p>'}
        </div>`;

    el.querySelector('#new-quote').onclick = () => openQuoteBuilder(null);
    el.querySelectorAll('[data-quote]').forEach(b => b.onclick = () => openQuoteBuilder(b.getAttribute('data-quote')));
}

function openQuoteBuilder(quoteId) {
    const existing = quoteId ? store.getQuote(quoteId) : null;
    // Working copy; only written to the store on Save
    const q = existing
        ? JSON.parse(JSON.stringify(existing))
        : { client: '', siteName: currentSiteName(), lines: buildAutoLines(), gst: true, notes: 'Quote valid for 30 days.' };

    const back = () => { nav.switchPage('page-notes'); renderJobPanels(); };

    openSub(existing ? existing.number : 'New Quote', (body, rerender) => {
        const rates = store.getRates();
        body.innerHTML = `
            <div class="card stack">
                <div class="form-group"><label>Client</label><input type="text" id="q-client" value="${esc(q.client)}" placeholder="Client or builder name"></div>
                <div class="form-group"><label>Site</label><input type="text" id="q-site" value="${esc(q.siteName)}"></div>
            </div>

            <div class="history-title-row">
                <h4 class="section-title">Line items</h4>
                <button class="link-btn small" id="q-rebuild">↻ Rebuild from job data</button>
            </div>
            <div class="quote-lines">
                ${q.lines.map((l, i) => `
                    <div class="card quote-line" data-line="${i}">
                        <input type="text" class="plain-input q-desc" value="${esc(l.desc)}" placeholder="Description">
                        <div class="quote-line-nums">
                            <label>Qty<input type="number" class="plain-input q-qty" value="${l.qty}" step="any" inputmode="decimal"></label>
                            <label>Unit<input type="text" class="plain-input q-unit" value="${esc(l.unit || '')}"></label>
                            <label>Rate<input type="number" class="plain-input q-rate" value="${l.rate}" step="any" inputmode="decimal"></label>
                            <strong class="q-amount">${money.format((Number(l.qty) || 0) * (Number(l.rate) || 0))}</strong>
                        </div>
                        <button class="text-action-link q-remove">Remove line</button>
                    </div>`).join('')}
            </div>
            <button class="btn btn-ghost" id="q-add-line">+ Add line</button>

            <div class="card stack">
                <label class="toggle-row plain"><span>Add GST (10%)</span><input type="checkbox" class="switch" id="q-gst" ${q.gst ? 'checked' : ''}></label>
                <div class="totals">
                    <div><span>Subtotal</span><span id="q-subtotal"></span></div>
                    <div><span>GST</span><span id="q-gst-amt"></span></div>
                    <div class="grand"><span>Total</span><span id="q-total"></span></div>
                </div>
                <div class="form-group"><label>Notes</label><textarea id="q-notes" rows="2">${esc(q.notes)}</textarea></div>
            </div>

            <details class="card advanced-box">
                <summary>Rate table (used when generating)</summary>
                <div class="dual-input-grid">
                    ${[
                        ['downlight', 'Downlight (ea)'], ['switchbox', 'Switch/outlet box (ea)'], ['plumbingPoint', 'Plumbing point (ea)'],
                        ['perMetre', 'Cable/pipe (per m)'], ['labourHour', 'Labour (per hr)'], ['callout', 'Call-out']
                    ].map(([k, label]) => `<div class="form-group"><label>${label}</label><input type="number" step="any" data-rate="${k}" value="${rates[k]}"></div>`).join('')}
                </div>
                <button class="btn btn-ghost" id="q-save-rates">Save rates &amp; rebuild lines</button>
            </details>

            <div class="btn-row">
                <button class="btn btn-ghost" id="q-share">Share</button>
                <button class="btn btn-ghost" id="q-print">Print / PDF</button>
            </div>
            <button class="btn btn-primary" id="q-save">Save Quote</button>
            ${existing ? '<button class="btn btn-danger-ghost" id="q-delete">Delete Quote</button>' : ''}`;

        const updateTotals = () => {
            const t = quoteTotals(q);
            body.querySelector('#q-subtotal').innerText = money.format(t.subtotal);
            body.querySelector('#q-gst-amt').innerText = money.format(t.gst);
            body.querySelector('#q-total').innerText = money.format(t.total);
        };
        updateTotals();

        // Keep the working copy in sync while typing (no full re-render)
        body.querySelector('#q-client').oninput = (e) => { q.client = e.target.value; };
        body.querySelector('#q-site').oninput = (e) => { q.siteName = e.target.value; };
        body.querySelector('#q-notes').oninput = (e) => { q.notes = e.target.value; };
        body.querySelector('#q-gst').onchange = (e) => { q.gst = e.target.checked; updateTotals(); };
        body.querySelectorAll('.quote-line').forEach(row => {
            const line = q.lines[Number(row.getAttribute('data-line'))];
            const refresh = () => {
                row.querySelector('.q-amount').innerText = money.format((Number(line.qty) || 0) * (Number(line.rate) || 0));
                updateTotals();
            };
            row.querySelector('.q-desc').oninput = (e) => { line.desc = e.target.value; };
            row.querySelector('.q-unit').oninput = (e) => { line.unit = e.target.value; };
            row.querySelector('.q-qty').oninput = (e) => { line.qty = Number.parseFloat(e.target.value) || 0; refresh(); };
            row.querySelector('.q-rate').oninput = (e) => { line.rate = Number.parseFloat(e.target.value) || 0; refresh(); };
            row.querySelector('.q-remove').onclick = () => { q.lines.splice(q.lines.indexOf(line), 1); rerender(); };
        });

        body.querySelector('#q-add-line').onclick = () => { q.lines.push({ desc: '', qty: 1, unit: 'ea', rate: 0 }); rerender(); };
        body.querySelector('#q-rebuild').onclick = () => {
            if (!confirm('Replace the line items with freshly generated ones from this job?')) return;
            q.lines = buildAutoLines();
            rerender();
        };
        body.querySelector('#q-save-rates').onclick = () => {
            const patch = {};
            body.querySelectorAll('[data-rate]').forEach(inp => { patch[inp.getAttribute('data-rate')] = Number.parseFloat(inp.value) || 0; });
            store.setRates(patch);
            q.lines = buildAutoLines();
            rerender();
        };
        body.querySelector('#q-save').onclick = () => {
            try {
                const saved = store.saveQuote(q);
                Object.assign(q, saved);
                toast(`Quote ${saved.number} saved`);
                back();
            } catch (err) { alert(err.message); }
        };
        body.querySelector('#q-delete')?.addEventListener('click', () => {
            if (!confirm('Delete this quote?')) return;
            store.removeQuote(existing.id);
            back();
        });
        body.querySelector('#q-share').onclick = () => shareQuote(q);
        body.querySelector('#q-print').onclick = () => printQuote(q);
    }, back);
}

function quoteText(q) {
    const t = quoteTotals(q);
    return [
        `Quote ${q.number || '(draft)'}${q.client ? ` for ${q.client}` : ''}`,
        q.siteName ? `Site: ${q.siteName}` : '',
        '',
        ...q.lines.map(l => `${l.desc}: ${l.qty} ${l.unit || ''} × ${money.format(l.rate)} = ${money.format(l.qty * l.rate)}`),
        '',
        `Subtotal: ${money.format(t.subtotal)}`,
        q.gst ? `GST: ${money.format(t.gst)}` : '',
        `Total: ${money.format(t.total)}`,
        q.notes ? `\n${q.notes}` : ''
    ].filter(line => line !== null).join('\n');
}

async function shareQuote(q) {
    const text = quoteText(q);
    if (navigator.share) {
        try { await navigator.share({ title: 'Quote', text }); return; } catch (err) { if (err.name === 'AbortError') return; }
    }
    try {
        await navigator.clipboard.writeText(text);
        toast('Quote copied to clipboard');
    } catch {
        alert(text);
    }
}

function printQuote(q) {
    const t = quoteTotals(q);
    const author = store.currentUser()?.name || '';
    const win = window.open('', '_blank');
    if (!win) return alert('Allow pop-ups to print the quote.');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(q.number || 'Quote')}</title>
        <style>
            body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #0d1f2d; padding: 32px; max-width: 760px; margin: auto; }
            h1 { margin: 0; color: #138d96; } table { width: 100%; border-collapse: collapse; margin-top: 24px; }
            th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e3e8ec; } td.n, th.n { text-align: right; }
            .totals { margin-top: 16px; margin-left: auto; width: 260px; } .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
            .grand { font-weight: 800; font-size: 1.2em; border-top: 2px solid #0d1f2d; } .muted { color: #6b7a86; }
        </style></head><body>
        <h1>Quote ${esc(q.number || '(draft)')}</h1>
        <p class="muted">${new Date().toLocaleDateString()}${author ? ` · Prepared by ${esc(author)}` : ''}</p>
        <p><strong>Client:</strong> ${esc(q.client || '-')}<br><strong>Site:</strong> ${esc(q.siteName || '-')}</p>
        <table><thead><tr><th>Description</th><th class="n">Qty</th><th>Unit</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead><tbody>
        ${q.lines.map(l => `<tr><td>${esc(l.desc)}</td><td class="n">${l.qty}</td><td>${esc(l.unit || '')}</td><td class="n">${money.format(l.rate)}</td><td class="n">${money.format(l.qty * l.rate)}</td></tr>`).join('')}
        </tbody></table>
        <div class="totals"><div><span>Subtotal</span><span>${money.format(t.subtotal)}</span></div>
        ${q.gst ? `<div><span>GST (10%)</span><span>${money.format(t.gst)}</span></div>` : ''}
        <div class="grand"><span>Total</span><span>${money.format(t.total)}</span></div></div>
        ${q.notes ? `<p class="muted">${esc(q.notes)}</p>` : ''}
        <script>window.onload = () => window.print();<\/script></body></html>`);
    win.document.close();
}
