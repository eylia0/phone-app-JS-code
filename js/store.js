// ==========================================================================
// LOCAL FAKE BACKEND
// Everything lives in localStorage so the app can be demoed on one device.
// Each exported function maps to what would later be an API call, so the
// screens won't need to change when a real backend is plugged in.
// ==========================================================================

const DB_KEY = 'tradeLinkDB';
const SESSION_KEY = 'tradeLinkSession';

// Files above this size keep their name/size only (localStorage is ~5MB total)
export const MAX_STORED_FILE_BYTES = 1.5 * 1024 * 1024;

export const TRADES = ['General', 'Electrical', 'Plumbing'];

export const PERMISSIONS = [
    { key: 'postUpdates', label: 'Post announcements & updates' },
    { key: 'messageMembers', label: 'Message other workers' },
    { key: 'viewDocuments', label: 'View documents & BIM' },
    { key: 'uploadDocuments', label: 'Upload documents' },
    { key: 'submitCompliance', label: 'Submit compliance' },
    { key: 'confirmCompliance', label: 'Confirm compliance' },
    { key: 'editSiteDetails', label: 'Edit site details' }
];

const WORKER_DEFAULTS = {
    postUpdates: true,
    messageMembers: true,
    viewDocuments: true,
    uploadDocuments: false,
    submitCompliance: true,
    confirmCompliance: false,
    editSiteDetails: false
};

export const COMPLIANCE_TEMPLATES = {
    Electrical: [
        'Downlight clearance to insulation (IC-4 rated or 75mm)',
        'Wet-area fittings rated IP44 or better',
        'Switch heights between 900-1200mm from floor',
        'RCD protection tested on all circuits'
    ],
    Plumbing: [
        'Pressure test passed (1500kPa, 30 min)',
        'Backflow prevention device installed',
        'Hot water tempered to max 50°C at outlets'
    ],
    General: [
        'Fall protection in place for work at height',
        'Work area clean and hazards tagged',
        'Fire stopping completed at penetrations'
    ]
};

// --------------------------------------------------------------------------
// Persistence
// --------------------------------------------------------------------------
function emptyDb() {
    return {
        users: [], sites: [], members: [], announcements: [], messages: [], documents: [], compliance: [],
        captures: [], planPoints: [], quotes: [], rates: { ...DEFAULT_RATES }
    };
}

// Quote rate table (editable in the quote builder, saved per device)
export const DEFAULT_RATES = {
    downlight: 85,
    switchbox: 65,
    plumbingPoint: 140,
    perMetre: 4.5,
    labourHour: 95,
    callout: 120
};

let db = loadDb();

function loadDb() {
    try {
        const raw = JSON.parse(localStorage.getItem(DB_KEY));
        if (raw && Array.isArray(raw.sites)) return { ...emptyDb(), ...raw };
    } catch (err) {
        console.warn('[Store] Could not read saved data, starting fresh.', err);
    }
    const fresh = emptyDb();
    seedDemo(fresh);
    writeDb(fresh);
    return fresh;
}

function writeDb(data) {
    try {
        localStorage.setItem(DB_KEY, JSON.stringify(data));
    } catch (err) {
        throw new Error('Device storage is full. Remove some documents and try again.');
    }
}

function save() { writeDb(db); }

export function resetDemoData() {
    db = emptyDb();
    seedDemo(db);
    save();
    clearSession();
}

const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// Unambiguous characters only (no 0/O, 1/I)
function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
        code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    } while (db.sites.some(s => s.code === code));
    return code;
}

function seedDemo(d) {
    const now = Date.now();
    const hour = 3600 * 1000;
    d.users.push(
        { id: 'u_demo_mgr', name: 'Sam Carter', email: 'sam@riverside.demo', trade: 'General' },
        { id: 'u_demo_jordan', name: 'Jordan Lee', trade: 'Electrical' },
        { id: 'u_demo_priya', name: 'Priya Nair', trade: 'Plumbing' }
    );
    d.sites.push({
        id: 's_demo',
        name: 'Riverside Apartments',
        location: 'Block A  |  Level 2',
        address: '12 River Rd, Parramatta NSW 2150',
        client: 'Riverside Developments',
        startDate: '2026-09-14',
        description: 'Fit-out of 24 apartments across Levels 1-3.',
        code: 'RIV842',
        managerId: 'u_demo_mgr',
        createdAt: now - 72 * hour
    });
    d.members.push(
        { siteId: 's_demo', userId: 'u_demo_mgr', role: 'manager', permissions: allPermissions(), joinedAt: now - 72 * hour },
        { siteId: 's_demo', userId: 'u_demo_jordan', role: 'worker', permissions: { ...WORKER_DEFAULTS }, joinedAt: now - 48 * hour },
        { siteId: 's_demo', userId: 'u_demo_priya', role: 'worker', permissions: { ...WORKER_DEFAULTS }, joinedAt: now - 30 * hour }
    );
    d.announcements.push({
        id: 'a_demo1', siteId: 's_demo', authorId: 'u_demo_mgr',
        text: 'Ceiling framing inspection on Level 2 this Thursday at 10am. Downlight cut-outs must be marked by Wednesday.',
        createdAt: now - 5 * hour
    });
    d.messages.push({
        id: 'm_demo1', siteId: 's_demo', fromId: 'u_demo_jordan', toId: 'u_demo_mgr',
        text: 'Downlight layout for unit 204 is ready to mark out.', createdAt: now - 2 * hour
    });
    d.compliance.push({
        id: 'c_demo1', siteId: 's_demo', title: 'Downlight clearance to insulation (IC-4 rated or 75mm)',
        trade: 'Electrical', note: 'Unit 204, all 12 fittings IC-4 rated.', submittedBy: 'u_demo_jordan',
        submittedAt: now - 3 * hour, status: 'submitted', reviews: []
    });
}

function allPermissions() {
    return Object.fromEntries(PERMISSIONS.map(p => [p.key, true]));
}

// --------------------------------------------------------------------------
// Session
// session = { role: 'manager' | 'linked' | 'standard', userId, siteId, localSite }
// --------------------------------------------------------------------------
export function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}
export function setSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
export function clearSession() {
    localStorage.removeItem(SESSION_KEY);
}

export function getUser(id) { return db.users.find(u => u.id === id) || null; }
export function getSite(id) { return db.sites.find(s => s.id === id) || null; }

export function currentUser() { return getUser(getSession()?.userId); }
export function currentSite() { return getSite(getSession()?.siteId); }

export function membership(siteId, userId) {
    return db.members.find(m => m.siteId === siteId && m.userId === userId) || null;
}

export function isManager() {
    const s = getSession();
    return !!s && s.role === 'manager' && membership(s.siteId, s.userId)?.role === 'manager';
}

// Linked-site permission check; managers can do everything, standalone users nothing
export function can(permKey) {
    const s = getSession();
    if (!s || !s.siteId) return false;
    const m = membership(s.siteId, s.userId);
    if (!m) return false;
    if (m.role === 'manager') return true;
    return !!m.permissions?.[permKey];
}

// Every account that has been used on this device (for the demo account switcher)
export function deviceAccounts() {
    return db.users.map(u => ({
        user: u,
        memberships: db.members.filter(m => m.userId === u.id).map(m => ({ ...m, site: getSite(m.siteId) }))
    })).filter(a => a.memberships.length > 0);
}

export function signInAs(userId, siteId) {
    const m = membership(siteId, userId);
    if (!m) throw new Error('That account is not linked to this site.');
    setSession({ role: m.role === 'manager' ? 'manager' : 'linked', userId, siteId });
}

// --------------------------------------------------------------------------
// Users / auth (fake)
// --------------------------------------------------------------------------
function findOrCreateUser({ name, email, trade }) {
    const cleanEmail = (email || '').trim().toLowerCase();
    let user = cleanEmail ? db.users.find(u => u.email === cleanEmail) : null;
    if (!user) {
        user = { id: uid('u'), name: name.trim(), email: cleanEmail || undefined, trade: trade || 'General' };
        db.users.push(user);
    } else {
        user.name = name.trim() || user.name;
        if (trade) user.trade = trade;
    }
    return user;
}

export function managerSignIn(name, email) {
    if (!name.trim() || !email.trim()) throw new Error('Please enter your name and email.');
    const user = findOrCreateUser({ name, email });
    save();
    setSession({ role: 'manager', userId: user.id, siteId: null });
    return user;
}

export function startStandardSession(name, location) {
    setSession({ role: 'standard', userId: null, siteId: null, localSite: { name, location } });
}

// --------------------------------------------------------------------------
// Sites & linking codes
// --------------------------------------------------------------------------
export function sitesManagedBy(userId) {
    return db.members
        .filter(m => m.userId === userId && m.role === 'manager')
        .map(m => getSite(m.siteId))
        .filter(Boolean);
}

export function selectManagedSite(siteId) {
    const s = getSession();
    if (membership(siteId, s?.userId)?.role !== 'manager') throw new Error('You do not manage this site.');
    setSession({ ...s, role: 'manager', siteId });
}

export function createSite({ name, location, address = '' }) {
    const s = getSession();
    if (!s || s.role !== 'manager') throw new Error('Sign in as a site manager first.');
    const site = {
        id: uid('s'),
        name: name.trim(),
        location: location.trim(),
        address: address.trim(),
        client: '',
        startDate: '',
        description: '',
        code: generateCode(),
        managerId: s.userId,
        createdAt: Date.now()
    };
    db.sites.push(site);
    db.members.push({ siteId: site.id, userId: s.userId, role: 'manager', permissions: allPermissions(), joinedAt: Date.now() });
    save();
    setSession({ ...s, siteId: site.id });
    return site;
}

export function updateSite(siteId, patch) {
    if (!can('editSiteDetails')) throw new Error('You do not have permission to edit site details.');
    const site = getSite(siteId);
    const allowed = ['name', 'location', 'address', 'client', 'startDate', 'description'];
    allowed.forEach(k => { if (k in patch) site[k] = String(patch[k]).trim(); });
    save();
    return site;
}

export function regenerateCode(siteId) {
    if (!isManager()) throw new Error('Only the site manager can change the linking code.');
    const site = getSite(siteId);
    site.code = generateCode();
    save();
    return site.code;
}

export function joinSite(code, name, trade) {
    const clean = (code || '').trim().toUpperCase();
    if (!clean) throw new Error('Please enter the site linking code.');
    if (!name.trim()) throw new Error('Please enter your name.');
    const site = db.sites.find(s => s.code === clean);
    if (!site) throw new Error('No site found for that code. Check it with your site manager.');

    // Returning worker on this site: reuse their account
    let user = db.members
        .filter(m => m.siteId === site.id)
        .map(m => getUser(m.userId))
        .find(u => u && u.name.toLowerCase() === name.trim().toLowerCase());
    if (!user) user = findOrCreateUser({ name, trade });
    else user.trade = trade || user.trade;

    let m = membership(site.id, user.id);
    if (!m) {
        m = { siteId: site.id, userId: user.id, role: 'worker', permissions: { ...WORKER_DEFAULTS }, joinedAt: Date.now() };
        db.members.push(m);
    }
    save();
    setSession({ role: m.role === 'manager' ? 'manager' : 'linked', userId: user.id, siteId: site.id });
    return { site, user };
}

// --------------------------------------------------------------------------
// Members & permissions
// --------------------------------------------------------------------------
export function membersOf(siteId) {
    return db.members
        .filter(m => m.siteId === siteId)
        .map(m => ({ ...m, user: getUser(m.userId) }))
        .filter(m => m.user)
        .sort((a, b) => (a.role === 'manager' ? -1 : 0) - (b.role === 'manager' ? -1 : 0) || a.user.name.localeCompare(b.user.name));
}

export function setPermission(siteId, userId, key, value) {
    if (!isManager()) throw new Error('Only the site manager can change permissions.');
    const m = membership(siteId, userId);
    if (!m || m.role === 'manager') return;
    m.permissions = { ...m.permissions, [key]: !!value };
    save();
}

export function removeMember(siteId, userId) {
    if (!isManager()) throw new Error('Only the site manager can remove people.');
    db.members = db.members.filter(m => !(m.siteId === siteId && m.userId === userId && m.role !== 'manager'));
    save();
}

// --------------------------------------------------------------------------
// Announcements / updates
// --------------------------------------------------------------------------
export function listAnnouncements(siteId) {
    return db.announcements.filter(a => a.siteId === siteId).sort((a, b) => b.createdAt - a.createdAt);
}

export function postAnnouncement(text) {
    if (!can('postUpdates')) throw new Error('You do not have permission to post updates on this site.');
    const s = getSession();
    const a = { id: uid('a'), siteId: s.siteId, authorId: s.userId, text: text.trim(), createdAt: Date.now() };
    db.announcements.push(a);
    save();
    return a;
}

export function deleteAnnouncement(id) {
    const s = getSession();
    const a = db.announcements.find(x => x.id === id);
    if (!a || !(isManager() || a.authorId === s.userId)) throw new Error('You can only remove your own posts.');
    db.announcements = db.announcements.filter(x => x.id !== id);
    save();
}

// --------------------------------------------------------------------------
// Direct messages
// --------------------------------------------------------------------------
// Workers can always message the manager; worker-to-worker needs permission
export function canMessage(otherUserId) {
    const s = getSession();
    if (!s?.siteId || otherUserId === s.userId) return false;
    const other = membership(s.siteId, otherUserId);
    if (!other) return false;
    if (isManager() || other.role === 'manager') return true;
    return can('messageMembers');
}

export function conversation(otherUserId) {
    const s = getSession();
    return db.messages
        .filter(m => m.siteId === s.siteId &&
            ((m.fromId === s.userId && m.toId === otherUserId) || (m.fromId === otherUserId && m.toId === s.userId)))
        .sort((a, b) => a.createdAt - b.createdAt);
}

export function lastMessageWith(otherUserId) {
    const thread = conversation(otherUserId);
    return thread[thread.length - 1] || null;
}

export function sendMessage(toId, text) {
    if (!canMessage(toId)) throw new Error('You do not have permission to message this person.');
    const s = getSession();
    const msg = { id: uid('m'), siteId: s.siteId, fromId: s.userId, toId, text: text.trim(), createdAt: Date.now() };
    db.messages.push(msg);
    save();
    return msg;
}

// --------------------------------------------------------------------------
// Documents & BIM
// --------------------------------------------------------------------------
export function listDocuments(siteId, kind) {
    return db.documents
        .filter(d => d.siteId === siteId && (!kind || d.kind === kind))
        .sort((a, b) => b.createdAt - a.createdAt);
}

export function addDocument({ name, type, size, dataUrl, kind = 'document' }) {
    if (!can('uploadDocuments')) throw new Error('You do not have permission to upload documents.');
    const s = getSession();
    const doc = {
        id: uid('d'), siteId: s.siteId, kind, name, type, size,
        dataUrl: size <= MAX_STORED_FILE_BYTES ? dataUrl : null,
        uploadedBy: s.userId, createdAt: Date.now()
    };
    // Only one active BIM/plan per site: newest replaces the old one
    if (kind === 'bim') db.documents = db.documents.filter(d => !(d.siteId === s.siteId && d.kind === 'bim'));
    db.documents.push(doc);
    save();
    return doc;
}

export function removeDocument(id) {
    const s = getSession();
    const doc = db.documents.find(d => d.id === id);
    if (!doc || !(isManager() || doc.uploadedBy === s.userId)) throw new Error('You can only remove your own uploads.');
    db.documents = db.documents.filter(d => d.id !== id);
    save();
}

// --------------------------------------------------------------------------
// Compliance
// status: 'submitted' -> 'confirmed' | 'changes'
// --------------------------------------------------------------------------
export function listCompliance(siteId) {
    return db.compliance.filter(c => c.siteId === siteId).sort((a, b) => b.submittedAt - a.submittedAt);
}

export function submitCompliance({ title, trade, note }) {
    if (!can('submitCompliance')) throw new Error('You do not have permission to submit compliance.');
    if (!title.trim()) throw new Error('Please choose or type a compliance item.');
    const s = getSession();
    const item = {
        id: uid('c'), siteId: s.siteId, title: title.trim(), trade, note: (note || '').trim(),
        submittedBy: s.userId, submittedAt: Date.now(), status: 'submitted', reviews: []
    };
    db.compliance.push(item);
    save();
    return item;
}

// Someone other than the submitter confirms (or sends back) an item
export function reviewCompliance(id, decision, note = '') {
    if (!can('confirmCompliance')) throw new Error('You do not have permission to confirm compliance.');
    const s = getSession();
    const item = db.compliance.find(c => c.id === id);
    if (!item) return;
    if (item.submittedBy === s.userId) throw new Error('Someone other than the submitter must confirm this item.');
    item.status = decision === 'confirm' ? 'confirmed' : 'changes';
    item.reviews.push({ userId: s.userId, decision, note: note.trim(), at: Date.now() });
    save();
}

export function resubmitCompliance(id, note = '') {
    const s = getSession();
    const item = db.compliance.find(c => c.id === id);
    if (!item || item.submittedBy !== s.userId) throw new Error('Only the submitter can resubmit this item.');
    item.status = 'submitted';
    if (note.trim()) item.note = note.trim();
    item.submittedAt = Date.now();
    save();
}

// --------------------------------------------------------------------------
// Job data workspace: a linked site, or a standalone (standard user) site
// --------------------------------------------------------------------------
export function workspaceKey() {
    const s = getSession();
    if (s?.siteId) return s.siteId;
    if (s?.localSite?.name) return `local:${s.localSite.name}`;
    return null;
}

function requireWorkspace() {
    const key = workspaceKey();
    if (!key) throw new Error('Pick or join a site first.');
    return key;
}

// --------------------------------------------------------------------------
// Captures: measurements / notes / layouts, stamped with time + location
// type: 'measurement' (valueMm) | 'note' (text) | 'layout' (item, count, detail)
// source: 'sidekick' | 'simulator' | 'manual' | 'app'
// --------------------------------------------------------------------------
export function addCapture(data) {
    const ws = requireWorkspace();
    const capture = { id: uid('cap'), ws, userId: getSession()?.userId || null, at: Date.now(), geo: null, ...data };
    db.captures.push(capture);
    save();
    return capture;
}

export function listCaptures(type) {
    const ws = workspaceKey();
    return db.captures
        .filter(c => c.ws === ws && (!type || c.type === type))
        .sort((a, b) => b.at - a.at);
}

export function removeCapture(id) {
    db.captures = db.captures.filter(c => c.id !== id);
    save();
}

// --------------------------------------------------------------------------
// BIM / plan points. Each plan has numbered points (n) so the Sidekick can
// refer to them in short BLE messages. A point is stored either as % of the
// plan image (picked in the app) or as cm (reported by the Sidekick).
// status: 'planned' -> 'sent' -> 'marked'   |  'from-site' (created on site)
// --------------------------------------------------------------------------
export function activePlan() {
    const ws = workspaceKey();
    return db.documents
        .filter(d => d.siteId === ws && d.kind === 'bim')
        .sort((a, b) => b.createdAt - a.createdAt)[0] || null;
}

export function setPlanMeta(docId, patch) {
    const doc = db.documents.find(d => d.id === docId);
    if (!doc) return;
    if ('widthM' in patch) doc.planWidthM = patch.widthM > 0 ? patch.widthM : null;
    if ('aspect' in patch) doc.planAspect = patch.aspect;
    save();
}

export function listPlanPoints(docId) {
    return db.planPoints.filter(p => p.docId === docId).sort((a, b) => a.n - b.n);
}

export function addPlanPoint(docId, data) {
    const n = Math.max(0, ...listPlanPoints(docId).map(p => p.n)) + 1;
    const point = {
        id: uid('pt'), docId, n, status: 'planned', createdBy: getSession()?.userId || null, createdAt: Date.now(),
        ...data,
        label: data.label || `Point ${n}`
    };
    db.planPoints.push(point);
    save();
    return point;
}

export function updatePlanPoint(id, patch) {
    const p = db.planPoints.find(x => x.id === id);
    if (!p) return null;
    Object.assign(p, patch);
    save();
    return p;
}

export function removePlanPoint(id) {
    db.planPoints = db.planPoints.filter(p => p.id !== id);
    save();
}

// Sidekick reported "MARK,<n>" for a point on the active plan
export function markPlanPoint(n, geo) {
    const plan = activePlan();
    if (!plan) return null;
    const point = listPlanPoints(plan.id).find(p => p.n === Number(n));
    if (!point) return null;
    return updatePlanPoint(point.id, { status: 'marked', markedAt: Date.now(), markedGeo: geo || null });
}

// --------------------------------------------------------------------------
// Quotes + rate table
// --------------------------------------------------------------------------
export function getRates() {
    return { ...DEFAULT_RATES, ...(db.rates || {}) };
}

export function setRates(rates) {
    db.rates = { ...getRates(), ...rates };
    save();
}

export function listQuotes() {
    const ws = workspaceKey();
    return db.quotes.filter(q => q.ws === ws).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getQuote(id) {
    return db.quotes.find(q => q.id === id) || null;
}

export function saveQuote(quote) {
    const ws = requireWorkspace();
    const existing = quote.id && db.quotes.find(q => q.id === quote.id);
    if (existing) {
        Object.assign(existing, quote, { updatedAt: Date.now() });
        save();
        return existing;
    }
    const number = `Q-${String(db.quotes.length + 1).padStart(4, '0')}`;
    const created = { ...quote, id: uid('q'), ws, number, createdBy: getSession()?.userId || null, createdAt: Date.now(), updatedAt: Date.now() };
    db.quotes.push(created);
    save();
    return created;
}

export function removeQuote(id) {
    db.quotes = db.quotes.filter(q => q.id !== id);
    save();
}
