// ==========================================================================
// SIDEKICK TWO-WAY PROTOCOL (v2)
// Runs alongside the original binary layout channel (2A56), which is unchanged.
// Messages are newline-terminated ASCII lines, e.g. "MEAS,1250,Kitchen wall\n".
// See docs/sidekick-protocol.md for the full list and Arduino example.
// ==========================================================================

export const NOTIFY_CHAR_UUID  = '00002a57-0000-1000-8000-00805f9b34fb'; // Sidekick -> app (notify)
export const COMMAND_CHAR_UUID = '00002a58-0000-1000-8000-00805f9b34fb'; // app -> Sidekick (write)

const BLE_CHUNK_BYTES = 20; // safe payload for the default BLE MTU
const MAX_LOG = 60;

let notifyChar = null;
let commandChar = null;
let rxBuffer = '';
let simulator = false;

const messageListeners = new Set();
const logListeners = new Set();
const log = [];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// --------------------------------------------------------------------------
// Connection lifecycle (called by app.js after the GATT service is found)
// --------------------------------------------------------------------------
export async function attach(service) {
    detach();
    try {
        notifyChar = await service.getCharacteristic(NOTIFY_CHAR_UUID);
        await notifyChar.startNotifications();
        notifyChar.addEventListener('characteristicvaluechanged', onValueChanged);
        addLog('sys', 'Receive channel ready (2A57)');
    } catch {
        notifyChar = null;
        addLog('sys', 'Sidekick has no receive channel (2A57): measurements/notes from the device are disabled');
    }
    try {
        commandChar = await service.getCharacteristic(COMMAND_CHAR_UUID);
        addLog('sys', 'Command channel ready (2A58)');
    } catch {
        commandChar = null;
        addLog('sys', 'Sidekick has no command channel (2A58): sending points is disabled');
    }
    emitLog();
}

export function detach() {
    if (notifyChar) notifyChar.removeEventListener('characteristicvaluechanged', onValueChanged);
    notifyChar = null;
    commandChar = null;
    rxBuffer = '';
}

export function channelStatus() {
    return { receive: !!notifyChar, command: !!commandChar, simulator };
}

// --------------------------------------------------------------------------
// Receiving
// --------------------------------------------------------------------------
function onValueChanged(event) {
    rxBuffer += decoder.decode(event.target.value);
    let newline;
    while ((newline = rxBuffer.indexOf('\n')) >= 0) {
        const line = rxBuffer.slice(0, newline).trim();
        rxBuffer = rxBuffer.slice(newline + 1);
        if (line) handleLine(line, 'sidekick');
    }
    // Drop garbage that never terminates
    if (rxBuffer.length > 512) rxBuffer = '';
}

// Turns one protocol line into a message object, or null if invalid
export function parseLine(line) {
    const [rawType, ...rest] = line.split(',');
    const type = rawType.trim().toUpperCase();
    const num = (v) => Number.parseFloat(v);
    switch (type) {
        case 'MEAS': {
            const mm = num(rest[0]);
            return Number.isFinite(mm) ? { type: 'measurement', mm, label: rest.slice(1).join(',').trim() } : null;
        }
        case 'NOTE': {
            const text = rest.join(',').trim();
            return text ? { type: 'note', text } : null;
        }
        case 'MARK': {
            const n = Number.parseInt(rest[0], 10);
            return Number.isInteger(n) ? { type: 'mark', n } : null;
        }
        case 'PTNEW': {
            const xCm = num(rest[0]);
            const yCm = num(rest[1]);
            return Number.isFinite(xCm) && Number.isFinite(yCm)
                ? { type: 'site-point', xCm, yCm, label: rest.slice(2).join(',').trim() }
                : null;
        }
        case 'BATT': {
            const pct = Number.parseInt(rest[0], 10);
            return pct >= 0 && pct <= 100 ? { type: 'battery', pct } : null;
        }
        case 'REQ':
            return { type: 'request', what: (rest[0] || '').trim().toUpperCase() };
        default:
            return null;
    }
}

function handleLine(line, origin) {
    addLog('rx', line, origin);
    const msg = parseLine(line);
    if (!msg) {
        addLog('sys', `Ignored unknown message: ${line}`);
        emitLog();
        return;
    }
    msg.origin = origin;
    emitLog();
    messageListeners.forEach(fn => fn(msg));
}

export function onMessage(fn) {
    messageListeners.add(fn);
    return () => messageListeners.delete(fn);
}

// --------------------------------------------------------------------------
// Sending
// --------------------------------------------------------------------------
export function canSend() {
    return simulator || !!commandChar;
}

export async function sendLines(lines) {
    if (simulator) {
        lines.forEach(l => addLog('tx', l, 'simulator'));
        emitLog();
        return;
    }
    if (!commandChar) {
        throw new Error('Your Sidekick firmware does not support commands yet (needs characteristic 2A58). Turn on the simulator in Sidekick Console to test.');
    }
    for (const line of lines) {
        const bytes = encoder.encode(`${line}\n`);
        for (let i = 0; i < bytes.length; i += BLE_CHUNK_BYTES) {
            await commandChar.writeValue(bytes.slice(i, i + BLE_CHUNK_BYTES));
        }
        addLog('tx', line, 'sidekick');
    }
    emitLog();
}

// --------------------------------------------------------------------------
// Simulator (test without hardware)
// --------------------------------------------------------------------------
export function setSimulator(on) {
    simulator = !!on;
    addLog('sys', `Simulator ${simulator ? 'on' : 'off'}`);
    emitLog();
}

export function isSimulator() {
    return simulator;
}

export function simulateIncoming(line) {
    handleLine(line, 'simulator');
}

// --------------------------------------------------------------------------
// Console log
// --------------------------------------------------------------------------
function addLog(dir, text, origin = '') {
    log.unshift({ dir, text, origin, at: Date.now() });
    if (log.length > MAX_LOG) log.pop();
}

function emitLog() {
    logListeners.forEach(fn => fn(log));
}

export function getLog() {
    return log;
}

export function onLog(fn) {
    logListeners.add(fn);
    return () => logListeners.delete(fn);
}
