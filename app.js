let jobProfile = { name: '', location: '' };
let placementRegistry = [];
let switchboxRegistry = [];

// 🛠️ BLE GLOBAL VARIABLES (FIXED: Declared properly so script won't crash)
let bleDeviceCache = null;
let bleCharacteristicCache = null;

// BLE CONFIGURATION TARGETS
const ARDUINO_BLE_SERVICE_UUID = "0000180c-0000-1000-8000-00805f9b34fb"; // Standardized 180C
const ARDUINO_BLE_CHAR_UUID    = "00002a56-0000-1000-8000-00805f9b34fb"; // Standardized 2A56

function switchPage(pageId) {
    document.querySelectorAll('.step-view').forEach(p => p.classList.add('hidden'));
    document.getElementById(pageId).classList.remove('hidden');
}

// 1. Submit Profile & Move to Grid
document.getElementById('save-profile-btn').addEventListener('click', () => {
    const name = document.getElementById('job-name').value.trim();
    const loc = document.getElementById('job-location').value.trim();

    if (!name || !loc) return alert("Please fill out all fields.");

    jobProfile.name = name;
    jobProfile.location = loc;

    document.getElementById('active-profile-title').innerText = jobProfile.name;
    document.getElementById('active-profile-meta').innerText = `Location: ${jobProfile.location}`;
    switchPage('page-trade-grid');
});

// 2. Dynamic File Fetching Engine
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
            console.error("Error loading file:", err);
        }
    });
});

// 3. Setup Layout Elements Inside Injected Sub-Files
function setupTaskButtons() {
    const hubMenu = document.getElementById('elec-hub-menu');
    const downlightWorkspace = document.getElementById('elec-downlight-workspace');
    const switchboxWorkspace = document.getElementById('elec-switchbox-workspace');
    
    const openDownlightBtn = document.getElementById('open-downlight-btn');
    const openSwitchboxBtn = document.getElementById('open-switchbox-btn-row');
    const backToHubBtn1 = document.getElementById('back-to-elec-hub');
    const backToHubBtn2 = document.getElementById('back-to-elec-hub-2');

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
        backToHubBtn1.onclick = () => {
            downlightWorkspace.classList.add('hidden');
            hubMenu.classList.remove('hidden');
        };
        backToHubBtn2.onclick = () => {
            switchboxWorkspace.classList.add('hidden');
            hubMenu.classList.remove('hidden');
        };
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
    if (sendButton) {
        sendButton.onclick = () => {
            sendCommandToArduino(placementRegistry.length, "Downlight Matrix Transmission");
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
document.querySelector('.back-to-profile').addEventListener('click', () => switchPage('page-job-profile'));
document.querySelector('.back-to-trades').addEventListener('click', () => switchPage('page-trade-grid'));

// --- CORE BLUETOOTH TRANSMISSION ENGINE ---
async function sendCommandToArduino(payloadData, description) {
    console.log(`[BLE] Preparing payload transmission for: ${description}`);
    const statusBadge = document.getElementById('status-badge');

    // 🛠️ Check Web Bluetooth support before opening modal
    if (!navigator.bluetooth) {
        alert("Web Bluetooth is not supported on this browser. Please use Google Chrome or Microsoft Edge.");
        return;
    }

    try {
        if (!bleDeviceCache || !bleDeviceCache.gatt.connected) {
            console.log("[BLE] Opening device search picker...");
            
            // Forces Chrome to display ALL nearby Bluetooth devices without crashing on UUID syntax
            bleDeviceCache = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [
                    ARDUINO_BLE_SERVICE_UUID,
                    "19b10000-e8f2-537e-4f6c-d104768a1214"
                ] 
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

        alert("Connected successfully to Bluetooth Device!");

    } catch (error) {
        console.error("[BLE Error]", error);
        alert(`Bluetooth Error: ${error.message}`);
    }
}

// --- MODULE C: INDEPENDENT COMPLIANCE LEGAL OVERLAY POPUPS ---
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
// 5. GENERAL HANDYMAN TRADE FUNCTIONS
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
        backToHub1.onclick = () => {
            tapeWorkspace.classList.add('hidden');
            genHubMenu.classList.remove('hidden');
        };
        backToHub2.onclick = () => {
            calcWorkspace.classList.add('hidden');
            genHubMenu.classList.remove('hidden');
        };
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

        outArea.innerText = `${flatArea.toLocaleString()} cm²`;
        outVolume.innerText = `${cubicVolume.toLocaleString()} cm³`;
        outSurface.innerText = `${surfaceArea.toLocaleString()} cm²`;
        outCircum.innerText = `${Math.round(circumferenceCircle).toLocaleString()} cm`;
    }

    if (inpL) inpL.oninput = runSpatialCalculator;
    if (inpW) inpW.oninput = runSpatialCalculator;
    if (inpD) inpD.oninput = runSpatialCalculator;
}