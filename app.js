let jobProfile = { name: '', location: '' };
let placementRegistry = [];
let switchboxRegistry = [];

// BLE GLOBAL VARIABLES
let bleDeviceCache = null;
let bleCharacteristicCache = null;

// BLE CONFIGURATION TARGETS
const ARDUINO_BLE_SERVICE_UUID = "0000180c-0000-1000-8000-00805f9b34fb"; // Standardized 180C
const ARDUINO_BLE_CHAR_UUID    = "00002a56-0000-1000-8000-00805f9b34fb"; // Standardized 2A56

function switchPage(pageId) {
    document.querySelectorAll('.step-view').forEach(p => p.classList.add('hidden'));
    const targetPage = document.getElementById(pageId);
    if (targetPage) targetPage.classList.remove('hidden');

    // Silent background reconnect attempt whenever landing on the main home screen
    if (pageId === 'page-trade-grid') {
        attemptAutoConnect();
    }
}

// ==========================================================================
// 1. INITIAL LAUNCH: SCREEN 8 (SPLASH) TO SCREEN 0 (ONBOARDING)
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    // Show splash screen initially
    switchPage('page-splash');

    // Automatically transition to Screen 0 (Onboarding) after 2 seconds
    setTimeout(() => {
        switchPage('page-onboarding');
    }, 2000);

    setupOnboardingListeners();
    setupNotesEngine();

    // Attach click listener to Header Status Badge for manual connection on demand
    const statusBadge = document.getElementById('status-badge');
    if (statusBadge) {
        statusBadge.addEventListener('click', () => {
            connectToArduino(true);
        });
    }
});

// ==========================================================================
// 2. SCREEN 0 ONBOARDING & PREVIOUS SITES LOCAL STORAGE ENGINE
// ==========================================================================
function setupOnboardingListeners() {
    // --- TAB CONTROLLER SWITCHING ---
    const tabs = document.querySelectorAll('.role-tab');
    const panels = document.querySelectorAll('.role-panel');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            panels.forEach(p => p.classList.add('hidden'));

            tab.classList.add('active');
            const targetPanel = document.getElementById(tab.getAttribute('data-tab'));
            if (targetPanel) targetPanel.classList.remove('hidden');
        });
    });

    // Render saved site history when initializing
    renderPreviousSites();

    // Option A: Linked Code Mode
    const btnSubmitCode = document.getElementById('btn-submit-code');
    if (btnSubmitCode) {
        btnSubmitCode.addEventListener('click', () => {
            const codeInput = document.getElementById('site-linking-code');
            const code = codeInput ? codeInput.value.trim() : '';
            if (!code) return alert("Please enter a valid site linking code.");

            jobProfile.name = `Linked Site (${code.toUpperCase()})`;
            jobProfile.location = "Connected Site Session";

            updateProfileDisplay();

            // Navigate straight to the home screen without forcing a BLE picker
            switchPage('page-trade-grid');
        });
    }

    // Option B: Site Worker (No Code - Manual Site Details + History Save)
    const btnSaveUserSite = document.getElementById('btn-save-user-site');
    if (btnSaveUserSite) {
        btnSaveUserSite.addEventListener('click', () => {
            const nameInput = document.getElementById('user-job-name');
            const locInput = document.getElementById('user-job-location');
            const name = nameInput ? nameInput.value.trim() : '';
            const loc = locInput ? locInput.value.trim() : '';

            if (!name || !loc) return alert("Please fill out both site name and address.");

            jobProfile.name = name;
            jobProfile.location = loc;

            // Save site to local history array
            saveSiteToHistory(name, loc);

            updateProfileDisplay();
            switchPage('page-trade-grid');
        });
    }

    // Option C: Site Manager Mode
    const saveProfileBtn = document.getElementById('save-profile-btn');
    if (saveProfileBtn) {
        saveProfileBtn.addEventListener('click', () => {
            const nameInput = document.getElementById('job-name');
            const locInput = document.getElementById('job-location');
            const name = nameInput ? nameInput.value.trim() : '';
            const loc = locInput ? locInput.value.trim() : '';

            if (!name || !loc) return alert("Please fill out both site name and location.");

            jobProfile.name = name;
            jobProfile.location = loc;

            updateProfileDisplay();
            switchPage('page-trade-grid');
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
                <h5>${site.name}</h5>
                <p>${site.location}</p>
            </div>
            <span class="history-item-arrow">›</span>
        `;
        item.addEventListener('click', () => {
            jobProfile.name = site.name;
            jobProfile.location = site.location;
            updateProfileDisplay();
            switchPage('page-trade-grid');
        });
        historyList.appendChild(item);
    });
}

function updateProfileDisplay() {
    const titleEl = document.getElementById('active-profile-title');
    const metaEl = document.getElementById('active-profile-meta');
    if (titleEl) titleEl.innerText = jobProfile.name;
    if (metaEl) metaEl.innerText = `Location: ${jobProfile.location}`;

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
                author: 'Site Worker'
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
                <span class="activity-author">💛 ${item.author} (Work Note)</span>
                <span class="activity-time">${item.timestamp}</span>
            </div>
            <div class="activity-text">${item.text}</div>
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
    const offsetXInput = document.getElementById('wall-offset-x');
    const offsetYInput = document.getElementById('wall-offset-y');
    const gapXInput = document.getElementById('light-gap-x');
    const gapYInput = document.getElementById('light-gap-y');

    function generateMatrixLayout() {
        if (!canvas) return;
        placementRegistry = [];
        document.querySelectorAll('.blueprint-canvas .canvas-fixture-node').forEach(n => n.remove());
        
        const roomW = parseFloat(widthInput.value) || 400;
        const roomL = parseFloat(lengthInput.value) || 300;
        const offsetX = parseFloat(offsetXInput.value) || 50;
        const offsetY = parseFloat(offsetYInput.value) || 50;
        const gapX = parseFloat(gapXInput.value) || 100;
        const gapY = parseFloat(gapYInput.value) || 100;
        
        const ratio = roomL / roomW;
        canvas.style.width = `100%`;
        canvas.style.height = `${canvas.parentElement.clientWidth * ratio}px`;
        if (gapX <= 0 || gapY <= 0) return;

        for (let currentX = offsetX; currentX <= (roomW - offsetX); currentX += gapX) {
            for (let currentY = offsetY; currentY <= (roomL - offsetY); currentY += gapY) {
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
                    fixtureTitle.innerText = `Fixtures Generated: ${placementRegistry.length}`;
                });
                canvas.appendChild(fixtureDot);
            }
        }
        fixtureTitle.innerText = `Fixtures Generated: ${placementRegistry.length}`;
    }
    if (calculateBtn) calculateBtn.onclick = generateMatrixLayout;
    
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

// --- GLOBAL BACK BUTTON NAVIGATION ---
const backToProfileBtn = document.querySelector('.back-to-profile');
if (backToProfileBtn) {
    backToProfileBtn.addEventListener('click', () => switchPage('page-onboarding'));
}

const backToTradesBtn = document.querySelector('.back-to-trades');
if (backToTradesBtn) {
    backToTradesBtn.addEventListener('click', () => switchPage('page-trade-grid'));
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

// Silent Background Auto-Connect Attempt (runs automatically on Home Screen)
async function attemptAutoConnect() {
    const statusBadge = document.getElementById('status-badge');
    
    if (bleDeviceCache && bleDeviceCache.gatt.connected) {
        if (statusBadge) {
            statusBadge.innerText = "Connected";
            statusBadge.className = "badge connected";
        }
        return;
    }

    if (navigator.bluetooth && navigator.bluetooth.getDevices) {
        try {
            const devices = await navigator.bluetooth.getDevices();
            const matchingDevice = devices.find(d => d.name && d.name.startsWith('TradeLink'));
            
            if (matchingDevice) {
                console.log("[BLE] Found previously paired device, attempting silent reconnect...");
                bleDeviceCache = matchingDevice;
                
                bleDeviceCache.addEventListener('gattserverdisconnected', () => {
                    if (statusBadge) {
                        statusBadge.innerText = "Disconnected";
                        statusBadge.className = "badge disconnected";
                    }
                    bleCharacteristicCache = null;
                });

                const server = await bleDeviceCache.gatt.connect();
                const service = await server.getPrimaryService(ARDUINO_BLE_SERVICE_UUID);
                bleCharacteristicCache = await service.getCharacteristic(ARDUINO_BLE_CHAR_UUID);

                if (statusBadge) {
                    statusBadge.innerText = "Connected";
                    statusBadge.className = "badge connected";
                }
                console.log("[BLE] Silent auto-reconnect successful!");
            }
        } catch (err) {
            console.log("[BLE] Silent auto-connect skipped or failed:", err);
        }
    }
}

// Manual Connection Picker (triggered when clicking Disconnected badge)
async function connectToArduino(userInitiated = true) {
    console.log("[BLE] Connection requested...");
    const statusBadge = document.getElementById('status-badge');

    if (!navigator.bluetooth) {
        if (userInitiated) {
            alert("Web Bluetooth is not supported on this browser. Please use Google Chrome or Microsoft Edge.");
        }
        return false;
    }

    try {
        if (!bleDeviceCache || !bleDeviceCache.gatt.connected) {
            if (statusBadge) {
                statusBadge.innerText = "Connecting...";
            }

            console.log("[BLE] Opening device search picker...");
            
               
            bleDeviceCache = await navigator.bluetooth.requestDevice({
                filters: [{ services: [ARDUINO_BLE_SERVICE_UUID] }] 
            });

            bleDeviceCache.addEventListener('gattserverdisconnected', () => {
                console.warn("[BLE] Arduino link dropped.");
                if (statusBadge) {
                    statusBadge.innerText = "Disconnected";
                    statusBadge.className = "badge disconnected";
                }
                bleCharacteristicCache = null;
            });

            console.log("[BLE] Connecting to GATT Server...");
            const server = await bleDeviceCache.gatt.connect();

            console.log("[BLE] Fetching primary service...");
            const service = await server.getPrimaryService(ARDUINO_BLE_SERVICE_UUID);

            console.log("[BLE] Fetching characteristic...");
            bleCharacteristicCache = await service.getCharacteristic(ARDUINO_BLE_CHAR_UUID);
        }

        if (statusBadge) {
            statusBadge.innerText = "Connected";
            statusBadge.className = "badge connected";
        }

        console.log("[BLE] Successfully connected!");
        return true;

    } catch (error) {
        console.error("[BLE Error]", error);
        if (statusBadge) {
            statusBadge.innerText = "Disconnected";
            statusBadge.className = "badge disconnected";
        }
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