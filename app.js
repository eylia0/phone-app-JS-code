import * as store from './js/store.js';
import {
    initSiteUI, openSiteHub, renderSiteHub, renderManagerSites, renderAccountCard,
    openAccountSwitcher, openAnnouncements, esc, timeAgo
} from './js/site.js';

let jobProfile = { name: '', location: '' };
let placementRegistry = [];
let switchboxRegistry = [];

// BLE GLOBAL VARIABLES
let bleDeviceCache = null;
let bleCharacteristicCache = null;

// BLE CONFIGURATION TARGETS
const ARDUINO_BLE_SERVICE_UUID = "0000180c-0000-1000-8000-00805f9b34fb"; // Standardized 180C
const ARDUINO_BLE_CHAR_UUID    = "00002a56-0000-1000-8000-00805f9b34fb"; // Standardized 2A56

// Pages that show the bottom tab bar
const TAB_PAGES = ['page-trade-grid', 'page-site', 'page-notes', 'page-more'];

function switchPage(pageId) {
    document.querySelectorAll('.step-view').forEach(p => p.classList.add('hidden'));
    const targetPage = document.getElementById(pageId);
    if (targetPage) targetPage.classList.remove('hidden');

    const viewport = document.querySelector('.content-viewport');
    if (viewport) viewport.scrollTop = 0;

    // Bottom tab bar: only on main tabs, highlight the active one
    const nav = document.getElementById('bottom-nav');
    if (nav) {
        nav.classList.toggle('hidden', !TAB_PAGES.includes(pageId));
        nav.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-go') === pageId);
        });
    }

    // Refresh role-dependent screens when they are opened
    if (pageId === 'page-site') renderSiteHub();
    if (pageId === 'page-more') renderAccountCard();
    if (pageId === 'page-manager-sites') renderManagerSites();
    if (pageId === 'page-trade-grid') renderHomeExtras();

    // Silent background reconnect attempt on the start and home screens
    if (pageId === 'page-trade-grid' || pageId === 'page-onboarding') {
        attemptAutoConnect();
    }
}

// Any element with data-go="page-id" navigates there (works for injected trade pages too)
document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-go]');
    if (!target) return;
    switchPage(target.getAttribute('data-go'));
    const focusId = target.getAttribute('data-focus');
    if (focusId) document.getElementById(focusId)?.focus();
});

// ==========================================================================
// 1. INITIAL LAUNCH: SPLASH, THEN RESUME THE SAVED SESSION OR SHOW START
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    switchPage('page-splash');

    initSiteUI({ switchPage, onSiteChanged: applySession });
    setupOnboardingListeners();
    setupNotesEngine();
    setupMoreListeners();

    // Bluetooth cards (start screen, home tool card, More tab) connect on demand
    ['bt-start-card', 'tool-card', 'more-bt-row'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => connectToArduino(true));
    });

    setTimeout(routeFromSession, 2000);
});

function routeFromSession() {
    const s = store.getSession();
    if (!s) return switchPage('page-onboarding');
    if (s.role === 'manager' && !store.currentSite()) return switchPage('page-manager-sites');
    if (s.role === 'linked' && !store.membership(s.siteId, s.userId)) {
        // Removed from the site by the manager since last launch
        store.clearSession();
        alert('You are no longer linked to that site. Ask your site manager for a new code.');
        return switchPage('page-onboarding');
    }
    applySession();
    switchPage('page-trade-grid');
}

// Copy the session's site into the home screen + toggle role-only UI
function applySession() {
    const s = store.getSession();
    const site = store.currentSite();
    if (site) {
        jobProfile.name = site.name;
        jobProfile.location = site.location;
    } else if (s?.localSite) {
        jobProfile.name = s.localSite.name;
        jobProfile.location = s.localSite.location;
    }
    // Site tab only exists for people linked to a managed site
    document.querySelectorAll('.linked-only').forEach(el => el.classList.toggle('hidden', !site));
    updateProfileDisplay();
    renderHomeExtras();
    renderAccountCard();
}

// Manager code chip + latest announcement banner on Home
function renderHomeExtras() {
    const site = store.currentSite();
    const codeChip = document.getElementById('active-site-code');
    if (codeChip) {
        codeChip.classList.toggle('hidden', !(site && store.isManager()));
        if (site) codeChip.innerText = `Site code ${site.code}`;
    }
    const banner = document.getElementById('home-announcement');
    if (!banner) return;
    const latest = site ? store.listAnnouncements(site.id)[0] : null;
    banner.classList.toggle('hidden', !latest);
    if (latest) {
        const author = store.getUser(latest.authorId);
        banner.innerHTML = `
            <span class="announce-icon">📣</span>
            <span class="announce-text">
                <small>${esc(author?.name || '')} · ${timeAgo(latest.createdAt)}</small>
                <span>${esc(latest.text)}</span>
            </span>
            <svg class="chev"><use href="#i-chevron-right"/></svg>`;
    }
}

function changeSite() {
    const s = store.getSession();
    if (s?.role === 'manager') {
        store.setSession({ ...s, siteId: null });
        switchPage('page-manager-sites');
    } else {
        switchPage('page-onboarding');
    }
}

function setupMoreListeners() {
    document.getElementById('btn-change-site')?.addEventListener('click', changeSite);
    document.getElementById('more-change-site')?.addEventListener('click', changeSite);
    document.getElementById('more-switch-account')?.addEventListener('click', openAccountSwitcher);
    document.getElementById('home-announcement')?.addEventListener('click', () => {
        openAnnouncements(() => switchPage('page-trade-grid'));
    });
    document.getElementById('more-sign-out')?.addEventListener('click', () => {
        if (!confirm('Sign out of TradeLink on this device?')) return;
        store.clearSession();
        switchPage('page-onboarding');
    });
    document.getElementById('more-reset-demo')?.addEventListener('click', () => {
        if (!confirm('Reset all demo sites, messages and compliance back to the sample data?')) return;
        store.resetDemoData();
        switchPage('page-onboarding');
    });
}

// ==========================================================================
// 2. ONBOARDING: LINKED CODE, STANDARD USER, SITE MANAGER
// ==========================================================================
function setupOnboardingListeners() {
    // Render saved site history when initializing
    renderPreviousSites();

    // Option A: Linked user joins with the manager's site code
    const btnSubmitCode = document.getElementById('btn-submit-code');
    if (btnSubmitCode) {
        btnSubmitCode.addEventListener('click', () => {
            const code = document.getElementById('site-linking-code')?.value || '';
            const name = document.getElementById('join-name')?.value || '';
            const trade = document.getElementById('join-trade')?.value || 'General';
            const connectNow = document.getElementById('join-connect')?.checked;

            try {
                store.joinSite(code, name, trade);
            } catch (err) {
                return alert(err.message);
            }

            applySession();
            switchPage('page-trade-grid');

            // Auto-connect the Sidekick: silent reconnect if paired before, otherwise
            // open the picker while we still have the button's user gesture
            const alreadyPaired = bleDeviceCache && bleDeviceCache.gatt.connected;
            if (connectNow && !alreadyPaired && navigator.bluetooth) {
                connectToArduino(false);
            }
        });
    }

    // Option B: Standard user (no code - manual site details + history save)
    const btnSaveUserSite = document.getElementById('btn-save-user-site');
    if (btnSaveUserSite) {
        btnSaveUserSite.addEventListener('click', () => {
            const nameInput = document.getElementById('user-job-name');
            const locInput = document.getElementById('user-job-location');
            const name = nameInput ? nameInput.value.trim() : '';
            const loc = locInput ? locInput.value.trim() : '';

            if (!name || !loc) return alert("Please fill out both site name and address.");

            // Save site to local history array
            saveSiteToHistory(name, loc);

            store.startStandardSession(name, loc);
            applySession();
            switchPage('page-trade-grid');
        });
    }

    // Option C: Site manager signs in, then picks or creates a site
    const btnMgrLogin = document.getElementById('btn-mgr-login');
    if (btnMgrLogin) {
        btnMgrLogin.addEventListener('click', () => {
            try {
                store.managerSignIn(
                    document.getElementById('mgr-name')?.value || '',
                    document.getElementById('mgr-email')?.value || ''
                );
            } catch (err) {
                return alert(err.message);
            }
            switchPage('page-manager-sites');
        });
    }

    const saveProfileBtn = document.getElementById('save-profile-btn');
    if (saveProfileBtn) {
        saveProfileBtn.addEventListener('click', () => {
            const nameInput = document.getElementById('job-name');
            const locInput = document.getElementById('job-location');
            const addrInput = document.getElementById('job-address');
            const name = nameInput ? nameInput.value.trim() : '';
            const loc = locInput ? locInput.value.trim() : '';

            if (!name || !loc) return alert("Please fill out both site name and location.");

            try {
                store.createSite({ name, location: loc, address: addrInput ? addrInput.value : '' });
            } catch (err) {
                alert(err.message);
                return switchPage('page-manager-login');
            }
            [nameInput, locInput, addrInput].forEach(i => { if (i) i.value = ''; });

            // Land on the Site tab so the new linking code is front and centre
            applySession();
            openSiteHub();
        });
    }

    // Clear history button handler
    const btnClearHistory = document.getElementById('btn-clear-history');
    if (btnClearHistory) {
        btnClearHistory.addEventListener('click', (e) => {
            e.stopPropagation();
            localStorage.removeItem('tradeLinkSiteHistory');
            renderPreviousSites();
        });
    }
}

// Local Storage Helper: Save site entry
function saveSiteToHistory(name, location) {
    let history = JSON.parse(localStorage.getItem('tradeLinkSiteHistory')) || [];
    history = history.filter(site => site.name !== name);
    history.unshift({ name, location, date: new Date().toLocaleDateString() });

    if (history.length > 5) history.pop();

    localStorage.setItem('tradeLinkSiteHistory', JSON.stringify(history));
    renderPreviousSites();
}

// Local Storage Helper: Render history list
function renderPreviousSites() {
    const historyList = document.getElementById('previous-sites-list');
    if (!historyList) return;

    const history = JSON.parse(localStorage.getItem('tradeLinkSiteHistory')) || [];

    if (history.length === 0) {
        historyList.innerHTML = `<p class="empty-history-text">No previous sites saved yet.</p>`;
        return;
    }

    historyList.innerHTML = '';
    history.forEach(site => {
        const item = document.createElement('div');
        item.className = 'history-site-item';
        item.innerHTML = `
            <div class="history-site-info">
                <h5>${esc(site.name)}</h5>
                <p>${esc(site.location)}</p>
            </div>
            <span class="history-item-arrow">›</span>
        `;
        item.addEventListener('click', () => {
            store.startStandardSession(site.name, site.location);
            applySession();
            switchPage('page-trade-grid');
        });
        historyList.appendChild(item);
    });
}

function updateProfileDisplay() {
    const titleEl = document.getElementById('active-profile-title');
    const metaEl = document.getElementById('active-profile-meta');
    if (titleEl) titleEl.innerText = jobProfile.name;
    if (metaEl) metaEl.innerText = jobProfile.location;
    const notesLabel = document.getElementById('notes-site-label');
    if (notesLabel) notesLabel.innerText = jobProfile.name;

    // Automatically retrieve activity notes saved for this active site
    loadNotesForCurrentSite();
}

// ==========================================================================
// 3. SERVICENOW STYLE ACTIVITY STREAM ENGINE
// ==========================================================================
function setupNotesEngine() {
    const btnSaveNotes = document.getElementById('btn-save-notes');
    const notesInput = document.getElementById('site-notes-input');
    const statusText = document.getElementById('notes-saved-status');

    if (btnSaveNotes && notesInput) {
        btnSaveNotes.addEventListener('click', () => {
            const text = notesInput.value.trim();
            if (!text) return alert("Please type a note before posting.");

            const currentSiteKey = `activity_${jobProfile.name || 'default'}`;
            let activities = JSON.parse(localStorage.getItem(currentSiteKey)) || [];

            // Add new note to the top of the timeline
            activities.unshift({
                text: text,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' - ' + new Date().toLocaleDateString(),
                author: store.currentUser()?.name || 'Site Worker'
            });

            localStorage.setItem(currentSiteKey, JSON.stringify(activities));

            // Clear composer input field
            notesInput.value = '';

            // Render updated activity stream below
            loadNotesForCurrentSite();

            // Flash "Posted!" confirmation badge
            if (statusText) {
                statusText.classList.add('show');
                setTimeout(() => statusText.classList.remove('show'), 2000);
            }
        });
    }
}

function loadNotesForCurrentSite() {
    const streamContainer = document.getElementById('activity-stream-list');
    if (!streamContainer) return;

    const currentSiteKey = `activity_${jobProfile.name || 'default'}`;
    const activities = JSON.parse(localStorage.getItem(currentSiteKey)) || [];

    if (activities.length === 0) {
        streamContainer.innerHTML = `<p class="empty-stream-text">No work notes posted for this site yet.</p>`;
        return;
    }

    streamContainer.innerHTML = '';
    activities.forEach(item => {
        const card = document.createElement('div');
        card.className = 'activity-item';
        card.innerHTML = `
            <div class="activity-header">
                <span class="activity-author">💛 ${esc(item.author)} (Work Note)</span>
                <span class="activity-time">${esc(item.timestamp)}</span>
            </div>
            <div class="activity-text">${esc(item.text)}</div>
        `;
        streamContainer.appendChild(card);
    });
}

// ==========================================================================
// 4. DYNAMIC FILE FETCHING ENGINE
// ==========================================================================
document.querySelectorAll('.trade-tile').forEach(tile => {
    tile.addEventListener('click', async (e) => {
        const fileTarget = e.currentTarget.getAttribute('data-file');
        try {
            const response = await fetch(fileTarget);
            const htmlContent = await response.text();
            document.getElementById('trade-file-content').innerHTML = htmlContent;
            
            if (fileTarget.includes('electrical.html')) {
                setupTaskButtons(); 
            } else if (fileTarget.includes('general.html')) {
                setupGeneralTaskButtons(); 
            }
            
            setupLegalBubbles(); 
            switchPage('page-dynamic-trade-view');
        } catch (err) {
            console.error("Error loading sub-trade file:", err);
        }
    });
});

// ==========================================================================
// 5. ELECTRICAL TRADE SUB-VIEW LOGIC
// ==========================================================================
function setupTaskButtons() {
    const hubMenu = document.getElementById('elec-hub-menu');
    const downlightWorkspace = document.getElementById('elec-downlight-workspace');
    const switchboxWorkspace = document.getElementById('elec-switchbox-workspace');
    
    const openDownlightBtn = document.getElementById('open-downlight-btn');
    const openSwitchboxBtn = document.getElementById('open-switchbox-btn-row');
    const backToHubBtn1 = document.getElementById('back-to-elec-hub');
    const backToHubBtn2 = document.getElementById('back-to-elec-hub-2');
    const btnBackToCategories = document.getElementById('btn-back-to-categories');
    
    if (btnBackToCategories) {
        btnBackToCategories.onclick = () => {
            switchPage('page-trade-grid');
        };
    }



    if (openSwitchboxBtn) openSwitchboxBtn.classList.remove('disabled-feature');

    if (openDownlightBtn && openSwitchboxBtn) {
        openDownlightBtn.onclick = () => {
            hubMenu.classList.add('hidden');
            downlightWorkspace.classList.remove('hidden');
            goToLightStep(1);
            generateMatrixLayout();
        };
        openSwitchboxBtn.onclick = () => {
            hubMenu.classList.add('hidden');
            switchboxWorkspace.classList.remove('hidden');
            generateWallLayout(); 
        };
        if (backToHubBtn1) {
            backToHubBtn1.onclick = () => {
                downlightWorkspace.classList.add('hidden');
                hubMenu.classList.remove('hidden');
            };
        }
        if (backToHubBtn2) {
            backToHubBtn2.onclick = () => {
                switchboxWorkspace.classList.add('hidden');
                hubMenu.classList.remove('hidden');
            };
        }
    }

    // --- MODULE A: DOWNLIGHT CANVAS MATRIX ENGINE ---
    const canvas = document.getElementById('ceiling-blueprint-canvas');
    const calculateBtn = document.getElementById('calculate-blueprint-btn');
    const fixtureTitle = document.getElementById('fixture-counter-title');
    const sendButton = document.getElementById('send-matrix-btn');
    const widthInput = document.getElementById('room-width-input');
    const lengthInput = document.getElementById('room-length-input');
    const spacingInput = document.getElementById('light-spacing-input');
    const offsetXInput = document.getElementById('wall-offset-x');
    const offsetYInput = document.getElementById('wall-offset-y');
    const gapXInput = document.getElementById('light-gap-x');
    const gapYInput = document.getElementById('light-gap-y');
    const estLightsEl = document.getElementById('est-lights');
    const dimWLabel = document.getElementById('dim-w-label');
    const dimLLabel = document.getElementById('dim-l-label');

    // --- PLACE LIGHTS WIZARD STEPS (1 Room, 2 Spacing, 3 Send) ---
    function goToLightStep(step) {
        document.querySelectorAll('#dl-stepper .step').forEach(s => {
            const n = Number(s.getAttribute('data-step'));
            s.classList.toggle('active', n === step);
            s.classList.toggle('done', n < step);
        });
        document.querySelectorAll('#elec-downlight-workspace .step-panel').forEach(p => {
            p.classList.toggle('hidden', Number(p.getAttribute('data-panel')) !== step);
        });
    }
    document.querySelectorAll('#dl-stepper .step').forEach(s => {
        s.onclick = () => goToLightStep(Number(s.getAttribute('data-step')));
    });
    document.querySelectorAll('#elec-downlight-workspace [data-step-go]').forEach(b => {
        b.onclick = () => goToLightStep(Number(b.getAttribute('data-step-go')));
    });

    // Live preview while editing room size / spacing
    [widthInput, lengthInput, spacingInput, offsetXInput, offsetYInput, gapXInput, gapYInput].forEach(inp => {
        if (inp) inp.oninput = generateMatrixLayout;
    });

    // Inputs are in metres; layout math stays in cm
    const toCm = (input, fallbackCm) => {
        const m = parseFloat(input?.value);
        return m > 0 ? m * 100 : fallbackCm;
    };

    function generateMatrixLayout() {
        if (!canvas) return;
        placementRegistry = [];
        document.querySelectorAll('.blueprint-canvas .canvas-fixture-node').forEach(n => n.remove());

        const roomW = toCm(widthInput, 480);
        const roomL = toCm(lengthInput, 360);
        const spacing = toCm(spacingInput, 120);
        const gapX = toCm(gapXInput, spacing);
        const gapY = toCm(gapYInput, spacing);
        const offsetX = toCm(offsetXInput, gapX / 2);
        const offsetY = toCm(offsetYInput, gapY / 2);

        if (dimWLabel) dimWLabel.innerText = `${+(roomW / 100).toFixed(2)} m`;
        if (dimLLabel) dimLLabel.innerText = `${+(roomL / 100).toFixed(2)} m`;

        // Keep the plan in true proportion, capping very long rooms by height
        const ratio = roomL / roomW;
        const availW = canvas.parentElement.clientWidth;
        const maxH = 300;
        const drawW = availW * ratio > maxH ? maxH / ratio : availW;
        canvas.style.width = `${drawW}px`;
        canvas.style.height = `${drawW * ratio}px`;
        if (gapX <= 0 || gapY <= 0) return;

        // +0.5cm tolerance so metre->cm float rounding doesn't drop the last row
        for (let currentX = offsetX; currentX <= (roomW - offsetX) + 0.5; currentX += gapX) {
            for (let currentY = offsetY; currentY <= (roomL - offsetY) + 0.5; currentY += gapY) {
                const pctX = (currentX / roomW) * 100;
                const pctY = (currentY / roomL) * 100;
                const nodeId = `dl-${Math.round(currentX)}-${Math.round(currentY)}`;
                
                placementRegistry.push({ id: nodeId, x: Math.round(currentX), y: Math.round(currentY) });
                
                const fixtureDot = document.createElement('div');
                fixtureDot.className = 'canvas-fixture-node';
                fixtureDot.style.left = `${pctX}%`;
                fixtureDot.style.top = `${pctY}%`;
                
                fixtureDot.addEventListener('click', (e) => {
                    e.stopPropagation();
                    placementRegistry = placementRegistry.filter(node => node.id !== nodeId);
                    fixtureDot.remove();
                    updateLightCount();
                });
                canvas.appendChild(fixtureDot);
            }
        }
        updateLightCount();
    }
    function updateLightCount() {
        if (fixtureTitle) fixtureTitle.innerText = `Downlights: ${placementRegistry.length}`;
        if (estLightsEl) estLightsEl.innerText = placementRegistry.length;
    }

    // "Create Layout" builds the grid and moves to the Send step
    if (calculateBtn) calculateBtn.onclick = () => {
        generateMatrixLayout();
        goToLightStep(3);
    };
    
    // send Downlight to arduino via BLE
    if (sendButton) {
        sendButton.onclick = async () => {
            if (placementRegistry.length === 0) {
                return alert("No downlights generated yet. Please click 'Map Layout' first.");
            }

            console.log(`[BLE] Preparing layout matrix with ${placementRegistry.length} downlights...`);
            
            // Option A: Send total count + sequence of X,Y coordinates
            // Payload format: [Total Count, X1, Y1, X2, Y2, ...]
            const payload = [placementRegistry.length];
            
            placementRegistry.forEach(node => {
                // Constrain values to 0-255 byte limits (or scale down if room is > 255cm)
                const scaledX = Math.min(255, Math.round(node.x / 2)); // e.g. 400cm scaled to 200
                const scaledY = Math.min(255, Math.round(node.y / 2));
                payload.push(scaledX, scaledY);
            });

            // Transmit byte array over BLE
            if (bleCharacteristicCache) {
                try {
                    const dataBuffer = new Uint8Array(payload);
                    await bleCharacteristicCache.writeValue(dataBuffer);
                    alert(`✅ Transmitted layout containing ${placementRegistry.length} downlights to site!`);
                } catch (err) {
                    console.error("[BLE Transmission Error]", err);
                    alert(`Failed to transmit layout: ${err.message}`);
                }
            } else {
                // If not connected yet, trigger connection
                const connected = await connectToArduino(true);
                if (connected) {
                    sendButton.click(); // Re-trigger send after connecting
                }
            }
        };
    }

    // --- MODULE B: SWITCHBOX WALL ELEVATION ENGINE ---
    const wallCanvas = document.getElementById('wall-blueprint-canvas');
    const calculateSwitchboxBtn = document.getElementById('calculate-switchbox-btn');
    const sbCounterTitle = document.getElementById('sb-counter-title');
    const sendSwitchboxBtn = document.getElementById('send-switchbox-btn');

    const sbWallWidthInput = document.getElementById('sb-wall-width');
    const sbBoxHeightInput = document.getElementById('sb-box-height');
    const sbStartOffsetInput = document.getElementById('sb-start-offset');
    const sbBoxGapInput = document.getElementById('sb-box-gap');

    function generateWallLayout() {
        if (!wallCanvas) return;
        switchboxRegistry = [];
        document.querySelectorAll('.wall-canvas .canvas-switchbox-node').forEach(n => n.remove());

        const wallW = parseFloat(sbWallWidthInput.value) || 500;
        const targetHeight = parseFloat(sbBoxHeightInput.value) || 30; 
        const startX = parseFloat(sbStartOffsetInput.value) || 60;
        const gapX = parseFloat(sbBoxGapInput.value) || 90;

        const simulatedCeilingHeight = 270;
        const visualHeightPct = 100 - ((targetHeight / simulatedCeilingHeight) * 100);

        if (gapX <= 0) return;

        for (let currentX = startX; currentX <= (wallW - 20); currentX += gapX) {
            const visualPctX = (currentX / wallW) * 100;
            const boxId = `sb-${Math.round(currentX)}`;

            switchboxRegistry.push({ id: boxId, x: Math.round(currentX), z: Math.round(targetHeight) });

            const boxNode = document.createElement('div');
            boxNode.className = 'canvas-switchbox-node';
            boxNode.style.left = `${visualPctX}%`;
            boxNode.style.top = `${visualHeightPct}%`; 

            boxNode.addEventListener('click', (e) => {
                e.stopPropagation();
                switchboxRegistry = switchboxRegistry.filter(box => box.id !== boxId);
                boxNode.remove();
                sbCounterTitle.innerText = `Boxes Generated: ${switchboxRegistry.length}`;
            });

            wallCanvas.appendChild(boxNode);
        }
        sbCounterTitle.innerText = `Boxes Generated: ${switchboxRegistry.length}`;
    }
    if (calculateSwitchboxBtn) calculateSwitchboxBtn.onclick = generateWallLayout;
    
    if (sendSwitchboxBtn) {
        sendSwitchboxBtn.onclick = () => {
            if (switchboxRegistry.length === 0) return alert("No switchbox mapping matrix found.");
            sendCommandToArduino(switchboxRegistry.length, "Switchbox Layout Transmission");
        };
    }
}

// ==========================================================================
// 6. MODULE C: INDEPENDENT COMPLIANCE LEGAL OVERLAY POPUPS
// ==========================================================================
function setupLegalBubbles() {
    const modalOverlay = document.getElementById('legal-modal-overlay');
    const modalTitle = document.getElementById('modal-legal-title');
    const modalBody = document.getElementById('modal-legal-body');
    const closeModalBtn = document.getElementById('close-legal-modal-btn');
    const infoBubbles = document.querySelectorAll('.info-bubble');

    const legalDatabase = {
        downlight: `
            <strong>Ceiling Fixture Proximity Standards:</strong>
            <ul>
                <li><strong>Clearance:</strong> Keep recessed fixtures at least 50-100mm clear from structural timber joists to prevent heat buildup.</li>
                <li><strong>Insulation:</strong> Standard downlights require 75mm clearance from standard loft insulation unless IC-4 rated.</li>
                <li><strong>Wet Zones:</strong> If placing in bathrooms/showers, regulations require minimum IP44 water protection rating.</li>
            </ul>
        `,
        switchbox: `
            <strong>Wall Box Clearance Regulations:</strong>
            <ul>
                <li><strong>ADA/Building Code:</strong> Standard wall switches must sit between 90cm and 120cm from the finished floor line.</li>
                <li><strong>Power Outlets (General):</strong> Must sit a minimum of 30cm high from the floor line base context.</li>
                <li><strong>Wet Area Baselines:</strong> Keep boxes at least 60cm horizontally clear from water taps, sinks, or shower basins.</li>
            </ul>
        `,
        tape: `
            <strong>Handyman Construction Math Baselines:</strong>
            <ul>
                <li><strong>Area Calculation:</strong> Multiplies Length $\times$ Width. Used on-site to estimate flooring tiles, subfloor sheets, or paint coverage maps.</li>
                <li><strong>Cubic Volume:</strong> Length $\times$ Width $\times$ Depth. Vital for pouring concrete, mixing mortar, or filling gravel foundations.</li>
                <li><strong>Circumference:</strong> $2 \times \pi \times R$. Crucial for mapping circular columns, routing custom trim work, or tracking structural round columns.</li>
            </ul>
        `
    };

    if (modalOverlay && closeModalBtn && infoBubbles.length > 0) {
        infoBubbles.forEach(bubble => {
            const newBubble = bubble.cloneNode(true);
            bubble.parentNode.replaceChild(newBubble, bubble);
        });

        const activeBubbles = document.querySelectorAll('.info-bubble');
        activeBubbles.forEach(bubble => {
            bubble.addEventListener('click', (e) => {
                e.stopPropagation();
                const contentKey = bubble.getAttribute('data-legal');
                
                if (legalDatabase[contentKey]) {
                    modalTitle.innerText = contentKey === 'downlight' ? 'Downlight Placement Codes' : contentKey === 'switchbox' ? 'Switchbox Elevation Codes' : 'General Layout Code';
                    modalBody.innerHTML = legalDatabase[contentKey];
                    modalOverlay.classList.remove('hidden');
                }
            });
        });

        closeModalBtn.onclick = () => modalOverlay.classList.add('hidden');
        modalOverlay.onclick = (e) => {
            if (e.target === modalOverlay) modalOverlay.classList.add('hidden');
        };
    }
}

// ==========================================================================
// 7. GENERAL HANDYMAN TRADE FUNCTIONS
// ==========================================================================
let tapePoints = [];

function setupGeneralTaskButtons() {
    const genHubMenu = document.getElementById('gen-hub-menu');
    const tapeWorkspace = document.getElementById('gen-tape-workspace');
    const calcWorkspace = document.getElementById('gen-calc-workspace');
    
    const openTapeBtn = document.getElementById('open-tape-btn');
    const openCalcBtn = document.getElementById('open-calc-btn');
    const backToHub1 = document.getElementById('back-to-gen-hub-1');
    const backToHub2 = document.getElementById('back-to-gen-hub-2');

    if (openTapeBtn && openCalcBtn) {
        openTapeBtn.onclick = () => {
            genHubMenu.classList.add('hidden');
            tapeWorkspace.classList.remove('hidden');
            resetTapeMeasure();
        };
        openCalcBtn.onclick = () => {
            genHubMenu.classList.add('hidden');
            calcWorkspace.classList.remove('hidden');
            runSpatialCalculator();
        };
        if (backToHub1) {
            backToHub1.onclick = () => {
                tapeWorkspace.classList.add('hidden');
                genHubMenu.classList.remove('hidden');
            };
        }
        if (backToHub2) {
            backToHub2.onclick = () => {
                calcWorkspace.classList.add('hidden');
                genHubMenu.classList.remove('hidden');
            };
        }
    }

    const tapeCanvas = document.getElementById('tape-measure-canvas');
    const tapeStatusText = document.getElementById('tape-status-text');
    const clearTapeBtn = document.getElementById('clear-tape-btn');
    const targetVibeInput = document.getElementById('target-vibe-dist');

    if (tapeCanvas) {
        tapeCanvas.onclick = function (e) {
            if (tapePoints.length >= 2) return; 

            const rect = tapeCanvas.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;

            tapePoints.push({ x: clickX, y: clickY });

            const pin = document.createElement('div');
            pin.className = 'canvas-tape-pin';
            pin.style.left = `${(clickX / rect.width) * 100}%`;
            pin.style.top = `${(clickY / rect.height) * 100}%`;
            tapeCanvas.appendChild(pin);

            if (tapePoints.length === 1) {
                tapeStatusText.innerText = "Tap Point 2 to Compute Line";
            } else if (tapePoints.length === 2) {
                const dx = tapePoints[1].x - tapePoints[0].x;
                const dy = tapePoints[1].y - tapePoints[0].y;
                const pixelDistance = Math.sqrt(dx * dx + dy * dy);

                const calculatedCm = Math.round(pixelDistance * 1.5);
                tapeStatusText.innerText = `Measured Distance: ${calculatedCm} cm`;

                const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                const line = document.createElement('div');
                line.className = 'canvas-connecting-line';
                line.style.width = `${pixelDistance}px`;
                line.style.left = `${(tapePoints[0].x / rect.width) * 100}%`;
                line.style.top = `${(tapePoints[0].y / rect.height) * 100}%`;
                line.style.transform = `rotate(${angle}deg)`;
                tapeCanvas.appendChild(line);

                const targetAlertDistance = parseFloat(targetVibeInput.value) || 150;
                if (calculatedCm >= targetAlertDistance) {
                    if (navigator.vibrate) {
                        navigator.vibrate([200, 100, 200]); 
                    } else {
                        console.log("[Haptic Vibration] Proximity limit reached: " + calculatedCm + "cm");
                    }
                }
                
                sendCommandToArduino(calculatedCm, "Handyman Distance Measurement");
            }
        };
    }

    function resetTapeMeasure() {
        tapePoints = [];
        if (tapeCanvas) tapeCanvas.innerHTML = '';
        if (tapeStatusText) tapeStatusText.innerText = "Tap Point 1 to Begin";
    }
    if (clearTapeBtn) clearTapeBtn.onclick = resetTapeMeasure;

    const inpL = document.getElementById('calc-dim-l');
    const inpW = document.getElementById('calc-dim-w');
    const inpD = document.getElementById('calc-dim-d');

    const outArea = document.getElementById('out-area');
    const outVolume = document.getElementById('out-volume');
    const outSurface = document.getElementById('out-surface');
    const outCircum = document.getElementById('out-circum');

    function runSpatialCalculator() {
        const L = parseFloat(inpL.value) || 0;
        const W = parseFloat(inpW.value) || 0;
        const D = parseFloat(inpD.value) || 0;

        const flatArea = L * W;
        const cubicVolume = L * W * D;
        const surfaceArea = 2 * (L * W + L * D + W * D);
        const circumferenceCircle = 2 * Math.PI * L; 

        if (outArea) outArea.innerText = `${flatArea.toLocaleString()} cm²`;
        if (outVolume) outVolume.innerText = `${cubicVolume.toLocaleString()} cm³`;
        if (outSurface) outSurface.innerText = `${surfaceArea.toLocaleString()} cm²`;
        if (outCircum) outCircum.innerText = `${Math.round(circumferenceCircle).toLocaleString()} cm`;
    }

    if (inpL) inpL.oninput = runSpatialCalculator;
    if (inpW) inpW.oninput = runSpatialCalculator;
    if (inpD) inpD.oninput = runSpatialCalculator;
}

// ==========================================================================
// 8. CORE BLUETOOTH TRANSMISSION & AUTO-CONNECT ENGINE
// ==========================================================================

// Updates every Bluetooth indicator (start card, home tool card, More tab)
// state: 'connected' | 'connecting' | 'disconnected'
function setBleStatus(state) {
    const titles = {
        connected: { start: 'Bluetooth Connected', tool: 'Tool Connected', more: 'Connected' },
        connecting: { start: 'Connecting...', tool: 'Connecting...', more: 'Connecting...' },
        disconnected: { start: 'Bluetooth Disconnected', tool: 'Tool Disconnected', more: 'Disconnected' }
    }[state];
    const deviceName = (state === 'connected' && bleDeviceCache?.name) || '';

    const cards = {
        start: document.getElementById('bt-start-card'),
        tool: document.getElementById('tool-card'),
        more: document.getElementById('more-bt-row')
    };
    Object.entries(cards).forEach(([key, card]) => {
        if (!card) return;
        card.classList.toggle('is-connected', state === 'connected');
        card.classList.toggle('is-connecting', state === 'connecting');
        const title = card.querySelector('.bt-status-title');
        if (title) title.innerText = titles[key];
    });

    const startSub = cards.start?.querySelector('.bt-status-sub');
    if (startSub) startSub.innerText = state === 'connected' ? (deviceName || 'TradeLink Tools') : 'Tap to connect TradeLink tools';

    const toolSub = cards.tool?.querySelector('.bt-device-name');
    if (toolSub) toolSub.innerText = state === 'connected' ? (deviceName || 'TradeLink Sidekick') : 'Tap to connect';

    const battery = cards.tool?.querySelector('.battery');
    if (battery) {
        battery.classList.toggle('hidden', state !== 'connected');
        if (state === 'connected') readBatteryLevel();
    }
}

// Reads the standard BLE Battery Service if the Sidekick exposes it (optional)
async function readBatteryLevel() {
    const pctEl = document.querySelector('#tool-card .battery-pct');
    const fillEl = document.querySelector('#tool-card .battery-fill');
    try {
        const service = await bleDeviceCache.gatt.getPrimaryService('battery_service');
        const characteristic = await service.getCharacteristic('battery_level');
        const value = await characteristic.readValue();
        const pct = value.getUint8(0);
        if (pctEl) pctEl.innerText = `${pct}%`;
        if (fillEl) fillEl.style.width = `${pct}%`;
    } catch (err) {
        // Device has no battery service yet
        if (pctEl) pctEl.innerText = '--';
        if (fillEl) fillEl.style.width = '0';
    }
}

function handleBleDisconnect() {
    console.warn("[BLE] Sidekick link dropped.");
    bleCharacteristicCache = null;
    setBleStatus('disconnected');
}

// Silent Background Auto-Connect Attempt (runs on Start and Home screens)
async function attemptAutoConnect() {
    if (bleDeviceCache && bleDeviceCache.gatt.connected) {
        setBleStatus('connected');
        return;
    }

    if (navigator.bluetooth && navigator.bluetooth.getDevices) {
        try {
            const devices = await navigator.bluetooth.getDevices();
            const matchingDevice = devices.find(d => d.name && d.name.startsWith('TradeLink'));
            
            if (matchingDevice) {
                console.log("[BLE] Found previously paired device, attempting silent reconnect...");
                bleDeviceCache = matchingDevice;
                bleDeviceCache.removeEventListener('gattserverdisconnected', handleBleDisconnect);
                bleDeviceCache.addEventListener('gattserverdisconnected', handleBleDisconnect);

                const server = await bleDeviceCache.gatt.connect();
                const service = await server.getPrimaryService(ARDUINO_BLE_SERVICE_UUID);
                bleCharacteristicCache = await service.getCharacteristic(ARDUINO_BLE_CHAR_UUID);

                setBleStatus('connected');
                console.log("[BLE] Silent auto-reconnect successful!");
            }
        } catch (err) {
            console.log("[BLE] Silent auto-connect skipped or failed:", err);
        }
    }
}

// Manual Connection Picker (triggered from any Bluetooth card)
async function connectToArduino(userInitiated = true) {
    console.log("[BLE] Connection requested...");

    if (!navigator.bluetooth) {
        if (userInitiated) {
            alert("Web Bluetooth is not supported on this browser. Please use Google Chrome or Microsoft Edge.");
        }
        return false;
    }

    try {
        if (!bleDeviceCache || !bleDeviceCache.gatt.connected) {
            setBleStatus('connecting');

            console.log("[BLE] Opening device search picker...");
            bleDeviceCache = await navigator.bluetooth.requestDevice({
                filters: [{ services: [ARDUINO_BLE_SERVICE_UUID] }],
                optionalServices: ['battery_service']
            });

            bleDeviceCache.addEventListener('gattserverdisconnected', handleBleDisconnect);

            console.log("[BLE] Connecting to GATT Server...");
            const server = await bleDeviceCache.gatt.connect();

            console.log("[BLE] Fetching primary service...");
            const service = await server.getPrimaryService(ARDUINO_BLE_SERVICE_UUID);

            console.log("[BLE] Fetching characteristic...");
            bleCharacteristicCache = await service.getCharacteristic(ARDUINO_BLE_CHAR_UUID);
        }

        setBleStatus('connected');
        console.log("[BLE] Successfully connected!");
        return true;

    } catch (error) {
        console.error("[BLE Error]", error);
        setBleStatus('disconnected');
        return false;
    }
}

// Payload Command Dispatcher
async function sendCommandToArduino(payloadData, description) {
    let isConnected = bleDeviceCache && bleDeviceCache.gatt.connected;
    
    if (!isConnected) {
        isConnected = await connectToArduino(true);
    }
    
    if (isConnected && bleCharacteristicCache) {
        try {
            const dataBuffer = Uint8Array.of(payloadData);
            await bleCharacteristicCache.writeValue(dataBuffer);
            alert(`✅ Transmitted ${payloadData} to Arduino (${description})!`);
        } catch (err) {
            console.error("[BLE Write Error]", err);
            alert(`Failed to send data: ${err.message}`);
        }
    }
}