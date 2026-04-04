# Webhook Bridge

**Webhook Bridge** is a [Busch-Jaeger free@home](https://www.busch-jaeger.de/free-at-home) add-on that sends **HTTP POST** requests to URLs you configure when:

- a monitored **device channel** reports an output datapoint change, and/or  
- a **scene** is triggered (optional rules).

Use it to integrate lights, sensors, and scenes with home automation stacks, notification services, or any HTTP endpoint.

---

## Features

| | |
|---|---|
| **Device webhooks** | One or more rules per device serial; each rule maps to its own URL. |
| **Scene webhooks** | Optional rules per scene ID, or leave Scene ID empty to receive every scene trigger. |
| **Per-rule auth** | Optional custom header (e.g. `Authorization: Bearer …`) on each rule. |
| **Datapoint filter** | Per device rule: comma-separated PairingIds (names or numbers); empty = all datapoints. |
| **Retries** | Up to 3 attempts with exponential backoff (1 s → 2 s → 4 s) on HTTP errors or network failures. |
| **Live reload** | Saving configuration reconnects the add-on and applies new rules without a manual restart. |

---

## Requirements

- A free@home **System Access Point** with the **Local API** enabled and credentials you can use from this add-on.  
- **Node.js 18+** only if you build or develop locally (the packaged add-on runs on the SysAP environment).

---

## Configuration

In the free@home admin UI go to **Add-ons → Webhook Bridge** (or the name shown for this package).

### Settings (once)

| Parameter | Description |
|---|---|
| **SysAP URL** | Base URL of your System Access Point (e.g. `http://192.168.1.10` or `http://localhost` when developing against a tunnel). |
| **Username** / **Password** | Local API credentials. Without both, the add-on does not connect (no webhooks). |

### Webhook Rules (devices)

Add as many rows as you need. List entries show **device serial** and **webhook URL**.

| Parameter | Required | Description |
|---|---|---|
| **Device Serial Number** | ✓ | Device to monitor (e.g. `ABB700XXXXXX`). |
| **Webhook URL** | ✓ | Target for `POST` with JSON body. |
| **Auth Header Name** / **Value** | | Optional single header for outbound requests. |
| **Datapoint Filter** | | Comma-separated PairingIds; use enum names (e.g. `AL_SWITCH_ON_OFF`) or numeric ids. Empty = fire on any output datapoint change for that device. |

Several rules may use the **same** serial; every matching rule’s URL is called.

### Scene Webhook Rules

Optional. Same auth fields as device rules.

| Parameter | Required | Description |
|---|---|---|
| **Scene ID** | | free@home scene identifier. **Leave empty** to match **all** scenes. |
| **Webhook URL** | ✓ | Where to `POST` when a matching scene runs. |

---

## Webhook payloads

All requests use `POST`, `Content-Type: application/json`.

### Device output datapoint change

Emitted when a monitored channel fires `outputDatapointChanged` and the rule’s datapoint filter (if any) matches.

```json
{
  "timestamp": "2026-04-03T12:00:00.000Z",
  "deviceSerial": "ABB700XXXXXX",
  "deviceName": "Living room light",
  "channelNumber": 0,
  "floor": "1",
  "room": "12",
  "event": "outputDatapointChanged",
  "datapointId": 1,
  "datapointName": "AL_SWITCH_ON_OFF",
  "value": "1"
}
```

| Field | Meaning |
|---|---|
| `timestamp` | Event time (ISO 8601). |
| `deviceSerial` | Device serial from the SysAP. |
| `deviceName` | Display name, or serial if unnamed. |
| `channelNumber` | Channel index on the device. |
| `floor` / `room` | Location metadata when set on the channel; may be omitted. |
| `event` | Always `outputDatapointChanged` for this payload type. |
| `datapointId` | Numeric PairingId. |
| `datapointName` | Enum name when known, otherwise string form of the id. |
| `value` | New value as string. |

### Scene triggered

Emitted when the SysAP reports a scene activation and your scene rule matches (`sceneId` equal or rule has empty `sceneId`).

```json
{
  "timestamp": "2026-04-03T12:00:00.000Z",
  "event": "sceneTriggered",
  "sceneId": "sc1",
  "scene": {}
}
```

`scene` is the object provided by free@home for that scene (structure depends on firmware and scene content).

---

## Security notes

- Prefer **HTTPS** for webhook URLs when your network allows it.  
- Treat **Auth Header** values like passwords; they are stored in add-on configuration.  
- The add-on uses **HTTP Basic** auth toward the Local API (username/password in Settings).

---

## Development

### Install and build

```bash
npm install
npm run build        # TypeScript compile + validate add-on metadata
npm run buildProd    # production JS (no source maps)
```

### Tests

```bash
npm test             # Node’s built-in test runner (~49 tests)
```

### Package

```bash
npm run pack         # build script archive for installation
```

### Live debugging (SysAP running)

```bash
npm run journal        # stream add-on log output
npm run monitorstate   # application state
npm run monitorconfig  # configuration changes
```

---

## Architecture

```
src/
├── main.ts              Add-on entry: configuration changes → WebhookBridge.connect
├── types.ts             WebhookRule, SceneRule
├── ruleParser.ts        Parses add-on config into rules + datapoint filters
├── webhookSender.ts     POST with retries (injectable fetch/sleep for tests)
├── webhookBridge.ts     SysAP connection, device subscriptions, scene WebSocket messages
├── ruleParser.test.ts
├── webhookSender.test.ts
└── webhookBridge.test.ts
```

`WebhookSender` and `WebhookBridge` accept injected dependencies so behaviour can be tested without a real SysAP or network.

---

## License

MIT
