let jobProfile = { name: '', location: '' };
let placementRegistry = [];
let switchboxRegistry = [];

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
            
            // Core initialization calls right after new HTML code template lands
            setupTaskButtons(); 
            setupLegalBubbles(); 
            
            switchPage('page-dynamic-trade-view');
        } catch (err) {
            console.error("Error loading file:", err);
        }
    });
});

// 3. Setup Layout Elements Inside Injected Sub-Files
function setupTaskButtons() {
    // --- MAIN ELECTRICAL HUB ROUTING ---
    const hubMenu = document.getElementById('elec-hub-menu');
    const downlightWorkspace = document.getElementById('elec-downlight-workspace');
    const switchboxWorkspace = document.getElementById('elec-switchbox-workspace');
    
    const openDownlightBtn = document.getElementById('open-downlight-btn');
    const openSwitchboxBtn = document.getElementById('open-switchbox-btn-row');
    const backToHubBtn1 = document.getElementById('back-to-elec-hub');
    const backToHubBtn2 = document.getElementById('back-to-elec-hub-2');

    // Enable button styles on Option 2 menu row item if it exists
    if (openSwitchboxBtn) openSwitchboxBtn.classList.remove('disabled-feature');

    // Hub Event Navigation Binding
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
            alert(`Sending ${placementRegistry.length} downlight coordinates data to Arduino Nano BLE...`);
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
        const targetHeight = parseFloat(sbBoxHeightInput.value) || 30; // Matches power outlets default
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
            alert(`Uploading ${switchboxRegistry.length} switchbox items data to Arduino Nano BLE...`);
            sendCommandToArduino(switchboxRegistry.length, "Switchbox Layout Transmission");
        };
    }
}

// --- GLOBAL BACK BUTTON NAVIGATION ---
document.querySelector('.back-to-profile').addEventListener('click', () => switchPage('page-job-profile'));
document.querySelector('.back-to-trades').addEventListener('click', () => switchPage('page-trade-grid'));

function sendCommandToArduino(code, description) {
    alert(`Sending Code: ${code}\nAction: ${description}`);
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
        `
    };

    if (modalOverlay && closeModalBtn && infoBubbles.length > 0) {
        // Safe clear and rebuild click event assignments
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
                    modalTitle.innerText = contentKey === 'downlight' ? 'Downlight Placement Codes' : 'Switchbox Elevation Codes';
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