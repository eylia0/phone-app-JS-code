# Sidekick BLE Protocol

How the TradeLink app and the Sidekick device talk over Bluetooth LE.

## Service and characteristics

All on service **`180C`** (`0000180c-0000-1000-8000-00805f9b34fb`).

| UUID   | Direction        | Properties    | Format | Purpose |
|--------|------------------|---------------|--------|---------|
| `2A56` | app → Sidekick   | Write         | binary | **Unchanged.** Downlight layout + single-byte commands (see below). |
| `2A57` | Sidekick → app   | Notify        | text   | Measurements, notes, point marks, battery, requests. |
| `2A58` | app → Sidekick   | Write         | text   | Points to set out. |
| `180F`/`2A19` | Sidekick → app | Read  | uint8  | Optional standard Battery Service (0–100). |

The app connects to `2A56` exactly as before. `2A57` and `2A58` are optional: if they
are missing, the app still works and the Sidekick Console shows them as "Not available".

The device name should start with **`TradeLink`** so the app can reconnect silently.

## Legacy binary channel (`2A56`)

- Downlight layout: `[count, x1, y1, x2, y2, ...]`, each x/y is **cm ÷ 2** clamped to 0–255.
- Single values (switchbox count, tape measure cm) are written as one byte.

## Text channels (`2A57`, `2A58`)

- ASCII, one message per line, **terminated with `\n`**, fields separated by commas.
- Lines can be longer than one BLE packet: the app sends in 20-byte chunks, and the
  Sidekick may also split a line across several notifications. Buffer until `\n`.

### Sidekick → app (`2A57`, notify)

| Message | Example | App behaviour |
|---------|---------|---------------|
| `MEAS,<mm>[,<label>]` | `MEAS,1250,Kitchen wall` | Saves a measurement stamped with time, GPS location and user. |
| `NOTE,<text>` | `NOTE,Noggin needed above door` | Saves a note stamped with time + location. Text may contain commas. |
| `MARK,<n>` | `MARK,3` | Point `n` on the active plan becomes "Marked on site". |
| `PTNEW,<x_cm>,<y_cm>[,<label>]` | `PTNEW,250,180,Riser` | Adds a point captured on site to the plan (cm from plan top-left). |
| `BATT,<0-100>` | `BATT,76` | Updates the battery % on the Home tool card. |
| `REQ,NEXT` | `REQ,NEXT` | App replies on `2A58` with the next point that isn't marked yet. |

### App → Sidekick (`2A58`, write)

| Message | Example | Meaning |
|---------|---------|---------|
| `PT,<n>,<x_cm>,<y_cm>` | `PT,3,420,615` | Floor/ceiling point `n` from the BIM plan, cm from the plan's top-left corner. |
| `PW,<n>,<x_cm>,<height_mm>` | `PW,1,60,450` | Wall point `n` (plumbing set-out): cm from the left of the wall, mm above floor. |

## Arduino starter sketch (ArduinoBLE)

```cpp
#include <ArduinoBLE.h>

BLEService sidekickService("180C");
BLECharacteristic layoutChar("2A56", BLEWrite, 128);                          // legacy binary
BLECharacteristic notifyChar("2A57", BLENotify, 20);                          // Sidekick -> app
BLECharacteristic commandChar("2A58", BLEWrite | BLEWriteWithoutResponse, 20); // app -> Sidekick

String cmdBuffer;

void sendLine(const String& line) {
  String msg = line + "\n";
  for (unsigned int i = 0; i < msg.length(); i += 20) {   // split into 20-byte packets
    String part = msg.substring(i, i + 20);
    notifyChar.writeValue((const uint8_t*)part.c_str(), part.length());
    delay(10);
  }
}

void handleCommand(const String& line) {
  // e.g. "PT,3,420,615" or "PW,1,60,450"
  int c1 = line.indexOf(','), c2 = line.indexOf(',', c1 + 1), c3 = line.indexOf(',', c2 + 1);
  String type = line.substring(0, c1);
  int n = line.substring(c1 + 1, c2).toInt();
  int a = line.substring(c2 + 1, c3).toInt();
  int b = line.substring(c3 + 1).toInt();
  if (type == "PT") { /* drive laser to floor point n at (a cm, b cm) */ }
  if (type == "PW") { /* drive laser to wall point n at a cm along, b mm high */ }
  // When the point has been marked on site:
  // sendLine("MARK," + String(n));
}

void setup() {
  BLE.begin();
  BLE.setLocalName("TradeLink Sidekick");
  BLE.setAdvertisedService(sidekickService);
  sidekickService.addCharacteristic(layoutChar);
  sidekickService.addCharacteristic(notifyChar);
  sidekickService.addCharacteristic(commandChar);
  BLE.addService(sidekickService);
  BLE.advertise();
}

void loop() {
  BLEDevice central = BLE.central();
  while (central && central.connected()) {
    if (layoutChar.written()) {
      // existing downlight / single-byte handling stays here
    }
    if (commandChar.written()) {
      const uint8_t* data = commandChar.value();             // not null-terminated
      for (int i = 0; i < commandChar.valueLength(); i++) cmdBuffer += (char)data[i];
      int nl;
      while ((nl = cmdBuffer.indexOf('\n')) >= 0) {
        handleCommand(cmdBuffer.substring(0, nl));
        cmdBuffer = cmdBuffer.substring(nl + 1);
      }
    }
    // Examples of sending to the app:
    // sendLine("MEAS,1250,Kitchen wall");
    // sendLine("NOTE,Noggin needed above door");
    // sendLine("BATT,76");
    // sendLine("REQ,NEXT");
  }
}
```

## Testing without hardware

In the app: **Notes → Sidekick → Sidekick Console**.
- Turn on **Simulator** to "send" points without a device (they appear in the log as TX).
- Tap the sample buttons, or type any line (e.g. `MEAS,1500,Hallway`) and press **Inject**
  to act as if the Sidekick had sent it.
