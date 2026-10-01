// ==========================================================================
// PLUMBING TRADE TEMPLATES: fixture set-out + pipe fall calculator
// ==========================================================================
import * as sidekick from './sidekick.js';
import { recordLayout, toast } from './jobdata.js';
import { esc } from './site.js';

// Typical rough-in heights (mm above finished floor). Indicative only.
export const FIXTURES = [
    { key: 'basin-waste', label: 'Basin waste', height: 450 },
    { key: 'basin-water', label: 'Basin water (H/C)', height: 550 },
    { key: 'toilet-stop', label: 'Toilet stop tap', height: 150 },
    { key: 'shower-mixer', label: 'Shower mixer', height: 1000 },
    { key: 'shower-rose', label: 'Shower rose', height: 2000 },
    { key: 'sink-waste', label: 'Kitchen sink waste', height: 450 },
    { key: 'washer-taps', label: 'Washing machine taps', height: 1050 }
];

const WALL_VIEW_HEIGHT_MM = 2400; // elevation drawn floor to 2.4m
let setoutPoints = [];

export function setupPlumbing() {
    const hub = document.getElementById('plumb-hub-menu');
    const setout = document.getElementById('plumb-setout-workspace');
    const fall = document.getElementById('plumb-fall-workspace');
    if (!hub) return;

    const show = (el) => {
        [hub, setout, fall].forEach(x => x.classList.add('hidden'));
        el.classList.remove('hidden');
    };
    document.getElementById('open-setout-btn').onclick = () => { show(setout); renderSetout(); };
    document.getElementById('open-fall-btn').onclick = () => { show(fall); runFall(); };
    document.getElementById('back-to-plumb-hub-1').onclick = () => show(hub);
    document.getElementById('back-to-plumb-hub-2').onclick = () => show(hub);

    setupSetout();
    setupFall();
}

// --------------------------------------------------------------------------
// Fixture set-out
// --------------------------------------------------------------------------
function setupSetout() {
    const fixtureSel = document.getElementById('po-fixture');
    const heightInput = document.getElementById('po-height');
    fixtureSel.innerHTML = FIXTURES.map(f => `<option value="${f.key}">${f.label} (${f.height} mm)</option>`).join('');
    const syncHeight = () => { heightInput.value = FIXTURES.find(f => f.key === fixtureSel.value).height; };
    fixtureSel.onchange = syncHeight;
    syncHeight();

    document.getElementById('po-wall-width').oninput = renderSetout;

    document.getElementById('po-add').onclick = () => {
        const wallCm = Number.parseFloat(document.getElementById('po-wall-width').value) || 0;
        const xCm = Number.parseFloat(document.getElementById('po-x').value);
        const zMm = Number.parseFloat(heightInput.value);
        if (!(xCm >= 0 && xCm <= wallCm)) return alert('Distance from left must be within the wall width.');
        if (!(zMm >= 0)) return alert('Enter a height from floor.');
        const fixture = FIXTURES.find(f => f.key === fixtureSel.value);
        setoutPoints.push({ n: setoutPoints.length + 1, label: fixture.label, xCm: Math.round(xCm), zMm: Math.round(zMm) });
        renderSetout();
    };

    // Wall points use "PW,<n>,<x_cm>,<height_mm>" (see docs/sidekick-protocol.md)
    document.getElementById('po-send').onclick = async () => {
        if (!setoutPoints.length) return alert('Add at least one point first.');
        try {
            await sidekick.sendLines(setoutPoints.map(p => `PW,${p.n},${p.xCm},${p.zMm}`));
            toast(`Sent ${setoutPoints.length} wall point${setoutPoints.length === 1 ? '' : 's'} to Sidekick`);
        } catch (err) {
            alert(err.message);
        }
    };

    document.getElementById('po-quote').onclick = () => recordLayout({
        trade: 'Plumbing',
        item: 'plumbing-point',
        count: setoutPoints.length,
        detail: setoutPoints.map(p => p.label).join(', ')
    });
}

function renderSetout() {
    const canvas = document.getElementById('po-wall-canvas');
    const list = document.getElementById('po-list');
    if (!canvas) return;
    const wallCm = Number.parseFloat(document.getElementById('po-wall-width').value) || 300;

    // Re-number after removals so the Sidekick sees 1..n
    setoutPoints.forEach((p, i) => { p.n = i + 1; });

    canvas.innerHTML = setoutPoints.map(p => `
        <button class="wall-point" data-n="${p.n}"
            style="left:${Math.min(100, (p.xCm / wallCm) * 100)}%; top:${100 - Math.min(100, (p.zMm / WALL_VIEW_HEIGHT_MM) * 100)}%"
            title="${esc(p.label)}">${p.n}</button>`).join('');
    document.getElementById('po-counter').innerText = `Points: ${setoutPoints.length}`;

    list.innerHTML = setoutPoints.map(p => `
        <div class="list-card point-row">
            <span class="plan-pin static pin-planned">${p.n}</span>
            <span class="list-card-text"><strong>${esc(p.label)}</strong><small>${p.xCm} cm from left · ${p.zMm} mm high</small></span>
        </div>`).join('');

    canvas.querySelectorAll('.wall-point').forEach(btn => btn.onclick = () => {
        setoutPoints = setoutPoints.filter(p => p.n !== Number(btn.getAttribute('data-n')));
        renderSetout();
    });
}

// --------------------------------------------------------------------------
// Pipe fall calculator
// --------------------------------------------------------------------------
function setupFall() {
    const sizeSel = document.getElementById('pf-size');
    const gradeInput = document.getElementById('pf-grade');
    sizeSel.onchange = () => { gradeInput.value = sizeSel.value; runFall(); };
    ['pf-length', 'pf-grade', 'pf-start'].forEach(id => { document.getElementById(id).oninput = runFall; });
}

function runFall() {
    const lengthM = Number.parseFloat(document.getElementById('pf-length').value) || 0;
    const gradePct = Number.parseFloat(document.getElementById('pf-grade').value) || 0;
    const startMm = Number.parseFloat(document.getElementById('pf-start').value) || 0;
    const minPct = Number.parseFloat(document.getElementById('pf-size').value);
    const warning = document.getElementById('pf-warning');

    const fallMm = lengthM * 1000 * (gradePct / 100);
    document.getElementById('pf-out-ratio').innerText = gradePct > 0 ? `1:${Math.round(100 / gradePct)}` : '-';
    document.getElementById('pf-out-fall').innerText = `${Math.round(fallMm)} mm`;
    document.getElementById('pf-out-end').innerText = `${Math.round(startMm + fallMm)} mm`;
    document.getElementById('pf-out-per-m').innerText = `${(gradePct * 10).toFixed(1)} mm/m`;

    const tooFlat = gradePct > 0 && gradePct < minPct;
    warning.classList.toggle('hidden', !tooFlat);
    if (tooFlat) warning.innerText = `⚠ ${gradePct}% is flatter than the typical minimum of ${minPct}% for this pipe size.`;
}
