// ==========================================================================
// BIM / PLAN POINTS: pick points on the plan, send them to the Sidekick,
// and show points the Sidekick marks or captures on site (two-way).
// Coordinates sent to the device are in cm from the plan's top-left corner.
// ==========================================================================
import * as store from './store.js';
import * as sidekick from './sidekick.js';
import { openSub, esc, timeAgo } from './site.js';
import { mapsLink } from './geo.js';

const STATUS_LABEL = {
    planned: 'Planned',
    sent: 'Sent to Sidekick',
    marked: 'Marked on site',
    'from-site': 'Captured on site'
};

// Real-world size the plan image covers, once width + image aspect are known
function planSizeCm(plan) {
    if (!plan?.planWidthM || !plan?.planAspect) return null;
    const w = plan.planWidthM * 100;
    return { w, h: w * plan.planAspect };
}

function pointPct(p, size) {
    if (p.xPct != null) return { x: p.xPct, y: p.yPct };
    if (size && p.xCm != null) return { x: (p.xCm / size.w) * 100, y: (p.yCm / size.h) * 100 };
    return null;
}

function pointCm(p, size) {
    if (p.xCm != null) return { x: p.xCm, y: p.yCm };
    if (size && p.xPct != null) return { x: (p.xPct / 100) * size.w, y: (p.yPct / 100) * size.h };
    return null;
}

const metres = (cm) => `${(cm / 100).toFixed(2)} m`;

export async function sendPoints(points) {
    const size = planSizeCm(store.activePlan());
    if (!size) throw new Error('Set the plan width first so points can be converted to real distances.');
    await sidekick.sendLines(points.map(p => {
        const c = pointCm(p, size);
        return `PT,${p.n},${Math.round(c.x)},${Math.round(c.y)}`;
    }));
    points.forEach(p => store.updatePlanPoint(p.id, { status: 'sent', sentAt: Date.now() }));
}

// Sidekick asked "REQ,NEXT": send the next point that isn't marked yet
export async function sendNextPoint() {
    const plan = store.activePlan();
    if (!plan) return null;
    const next = store.listPlanPoints(plan.id).find(p => p.status === 'planned' || p.status === 'sent');
    if (!next) return null;
    await sendPoints([next]);
    return next;
}

// Sidekick reported "PTNEW,x,y,label": a point captured on site appears on the plan
export function addSitePoint(msg, geo) {
    const plan = store.activePlan();
    if (!plan) return null;
    return store.addPlanPoint(plan.id, {
        xCm: msg.xCm, yCm: msg.yCm, label: msg.label, status: 'from-site',
        markedAt: Date.now(), markedGeo: geo || null
    });
}

export function openPlan(back) {
    openSub('Plan Points', (body, rerender) => {
        const plan = store.activePlan();
        if (!plan || !plan.dataUrl || !plan.type?.startsWith('image/')) {
            body.innerHTML = `<div class="card"><p class="muted">No image plan connected. Upload a PNG or JPG plan in Documents &amp; BIM to pick points.</p></div>`;
            return;
        }
        const size = planSizeCm(plan);
        const points = store.listPlanPoints(plan.id);
        const planned = points.filter(p => p.status === 'planned');
        const status = sidekick.channelStatus();

        body.innerHTML = `
            <div class="card plan-scale">
                <div class="form-group">
                    <label>Real width of this plan</label>
                    <div class="unit-field"><input type="number" id="plan-width" step="0.1" min="0.5" inputmode="decimal" value="${plan.planWidthM || ''}" placeholder="e.g. 12.5"><span>m</span></div>
                </div>
                <p class="subtle-hint">${size
                    ? `Plan covers ${metres(size.w)} × ${metres(size.h)}. Points are measured from the top-left corner.`
                    : 'Enter the real width the plan image covers so points convert to site distances.'}</p>
            </div>

            <div class="plan-stage" id="plan-stage">
                <img src="${plan.dataUrl}" id="plan-img" alt="Site plan" draggable="false">
                ${points.map(p => {
                    const pc = pointPct(p, size);
                    return pc ? `<button class="plan-pin pin-${p.status}" style="left:${pc.x}%;top:${pc.y}%" data-pin="${p.id}" aria-label="${esc(p.label)}">${p.n}</button>` : '';
                }).join('')}
            </div>
            <p class="subtle-hint center">Tap the plan to add a point to set out on site.</p>
            <div class="plan-legend">
                <span><i class="dot pin-planned"></i>Planned</span>
                <span><i class="dot pin-sent"></i>Sent</span>
                <span><i class="dot pin-marked"></i>Marked</span>
                <span><i class="dot pin-from-site"></i>From site</span>
            </div>

            <button class="btn btn-primary" id="send-planned" ${planned.length ? '' : 'disabled'}>
                Send ${planned.length} point${planned.length === 1 ? '' : 's'} to Sidekick
            </button>
            ${!status.command && !status.simulator ? '<p class="subtle-hint center">Sidekick command channel not connected. Use the simulator in Notes › Sidekick › Console to test.</p>' : ''}

            <h4 class="section-title">Points (${points.length})</h4>
            <div class="settings-list">
                ${points.length ? points.map(p => {
                    const c = pointCm(p, size);
                    const geo = p.markedGeo;
                    return `
                    <div class="list-card point-row">
                        <span class="plan-pin static pin-${p.status}">${p.n}</span>
                        <span class="list-card-text">
                            <strong>${esc(p.label)}</strong>
                            <small>${c ? `x ${metres(c.x)} · y ${metres(c.y)}` : 'Set plan width to see distances'}</small>
                            <small><span class="pill pill-pt-${p.status}">${STATUS_LABEL[p.status]}</span>
                                ${p.markedAt ? ` ${timeAgo(p.markedAt)}` : ''}
                                ${geo ? ` · <a href="${mapsLink(geo)}" target="_blank" rel="noopener">📍 ±${geo.acc} m</a>` : ''}</small>
                        </span>
                        <span class="member-actions">
                            <button class="mini-btn ghost" data-rename="${p.id}">Rename</button>
                            <button class="mini-btn ghost" data-remove="${p.id}">Remove</button>
                        </span>
                    </div>`;
                }).join('') : '<p class="empty-stream-text">No points yet.</p>'}
            </div>`;

        const img = body.querySelector('#plan-img');
        // Remember the image's aspect ratio so % positions convert to cm
        const syncAspect = () => {
            if (!img.naturalWidth) return;
            const aspect = img.naturalHeight / img.naturalWidth;
            if (Math.abs((plan.planAspect || 0) - aspect) > 0.0001) {
                store.setPlanMeta(plan.id, { aspect });
                rerender();
            }
        };
        if (img.complete) syncAspect(); else img.onload = syncAspect;

        img.onclick = (e) => {
            const rect = img.getBoundingClientRect();
            const xPct = ((e.clientX - rect.left) / rect.width) * 100;
            const yPct = ((e.clientY - rect.top) / rect.height) * 100;
            store.addPlanPoint(plan.id, { xPct: +xPct.toFixed(2), yPct: +yPct.toFixed(2) });
            rerender();
        };

        body.querySelector('#plan-width').onchange = (e) => {
            store.setPlanMeta(plan.id, { widthM: Number.parseFloat(e.target.value) });
            rerender();
        };

        body.querySelector('#send-planned').onclick = async () => {
            try {
                await sendPoints(planned);
                rerender();
            } catch (err) { alert(err.message); }
        };

        body.querySelectorAll('[data-rename]').forEach(b => b.onclick = () => {
            const p = points.find(x => x.id === b.getAttribute('data-rename'));
            const label = prompt('Point name:', p.label);
            if (label && label.trim()) { store.updatePlanPoint(p.id, { label: label.trim() }); rerender(); }
        });
        body.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => {
            if (!confirm('Remove this point?')) return;
            store.removePlanPoint(b.getAttribute('data-remove'));
            rerender();
        });
        body.querySelectorAll('[data-pin]').forEach(pin => pin.onclick = (e) => {
            e.stopPropagation();
            body.querySelector(`[data-rename="${pin.getAttribute('data-pin')}"]`)?.closest('.point-row')
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }, back, { live: true });
}
