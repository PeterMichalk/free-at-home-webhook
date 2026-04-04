import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WebhookBridge } from './webhookBridge';
import { WebhookSender } from './webhookSender';
import { FreeAtHomeApi, PairingIds } from '@busch-jaeger/free-at-home';
import { AddOn } from '@busch-jaeger/free-at-home';

type ConfigEntry = { items?: Record<string, unknown>; deletable?: boolean };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock of an ApiChannel. */
class MockChannel extends EventEmitter {
  constructor(
    public readonly serialNumber: string,
    public readonly channelNumber: number,
    public readonly floor: number | undefined,
    public readonly room: number | undefined,
    public readonly displayName: string | undefined
  ) { super(); }
}

/** Minimal mock of a real device returned by getAllDevices(). */
class MockDevice extends EventEmitter {
  channels: MockChannel[] = [];

  constructor(
    public readonly serialNumber: string,
    public readonly displayName: string
  ) { super(); }

  getChannels(): IterableIterator<MockChannel> { return this.channels.values(); }
}

/** Minimal mock of FreeAtHomeApi – extends EventEmitter so .on('open',...) works. */
class MockApi extends EventEmitter {
  disconnectCalled = false;
  devices: MockDevice[] = [];
  websocket = new EventEmitter();

  disconnect(): void { this.disconnectCalled = true; }
  async getAllDevices(): Promise<IterableIterator<MockDevice>> { return this.devices.values(); }
}

/** A WebhookSender that records every send() call instead of doing real HTTP. */
class SpySender extends WebhookSender {
  calls: Array<{ url: string; headers: Record<string, string>; payload: object }> = [];

  constructor() {
    // Inject a fetch that never resolves (unused because send is overridden)
    super(async () => { throw new Error('should not fetch'); });
  }

  override async send(url: string, extraHeaders: Record<string, string>, payload: object): Promise<void> {
    this.calls.push({ url, headers: extraHeaders, payload });
  }
}

function makeConfig(
  overrides: Record<string, ConfigEntry> = {}
): AddOn.Configuration {
  return {
    default: {
      items: { sysApUrl: 'http://sysap', username: 'user', password: 'pass' },
    },
    ...overrides,
  };
}

const deviceRule = (serial: string, url: string, filter = ''): ConfigEntry => ({
  items: { deviceSerial: serial, webhookUrl: url, datapointFilter: filter },
  deletable: true,
});

const sceneRule = (sceneId: string, url: string): ConfigEntry => ({
  items: { sceneId, webhookUrl: url },
  deletable: true,
});

// ---------------------------------------------------------------------------
// Connection guards
// ---------------------------------------------------------------------------

test('WebhookBridge: skips connection when username is missing', async () => {
  const sender = new SpySender();
  let factoryCalled = false;
  const bridge = new WebhookBridge(sender, () => { factoryCalled = true; return new MockApi() as any; });

  await bridge.connect({
    default: { items: { sysApUrl: 'http://x', username: '', password: 'pass' } },
    'rule-1': deviceRule('ABB700A', 'https://hook.io/a'),
  });

  assert.equal(factoryCalled, false);
});

test('WebhookBridge: skips connection when password is missing', async () => {
  const sender = new SpySender();
  let factoryCalled = false;
  const bridge = new WebhookBridge(sender, () => { factoryCalled = true; return new MockApi() as any; });

  await bridge.connect({
    default: { items: { sysApUrl: 'http://x', username: 'user', password: '' } },
    'rule-1': deviceRule('ABB700A', 'https://hook.io/a'),
  });

  assert.equal(factoryCalled, false);
});

test('WebhookBridge: skips connection when no rules are configured', async () => {
  const sender = new SpySender();
  let factoryCalled = false;
  const bridge = new WebhookBridge(sender, () => { factoryCalled = true; return new MockApi() as any; });

  await bridge.connect(makeConfig());

  assert.equal(factoryCalled, false);
});

test('WebhookBridge: passes correct URL and Basic-auth header to apiFactory', async () => {
  const sender = new SpySender();
  let capturedUrl = '';
  let capturedAuth: Record<string, string> = {};
  const mockApi = new MockApi();

  const bridge = new WebhookBridge(sender, (url, auth) => {
    capturedUrl  = url;
    capturedAuth = auth as Record<string, string>;
    return mockApi as any;
  });

  await bridge.connect(makeConfig({ 'rule-1': deviceRule('ABB700A', 'https://hook.io/a') }));

  assert.equal(capturedUrl, 'http://sysap');
  const expected = 'Basic ' + Buffer.from('user:pass').toString('base64');
  assert.equal(capturedAuth['Authorization'], expected);
});

// ---------------------------------------------------------------------------
// Device event dispatch
// ---------------------------------------------------------------------------

function makeDeviceWithChannel(
  serial: string,
  displayName: string,
  channelOpts: { channelNumber?: number; floor?: number; room?: number } = {}
): { device: MockDevice; channel: MockChannel } {
  const device  = new MockDevice(serial, displayName);
  const channel = new MockChannel(
    serial,
    channelOpts.channelNumber ?? 0,
    channelOpts.floor,
    channelOpts.room,
    displayName
  );
  device.channels = [channel];
  return { device, channel };
}

test('WebhookBridge: sends webhook when channel outputDatapointChanged fires', async () => {
  const sender  = new SpySender();
  const mockApi = new MockApi();
  const { device, channel } = makeDeviceWithChannel('ABB700A', 'Light');
  mockApi.devices = [device];

  const bridge = new WebhookBridge(sender, () => mockApi as any);
  await bridge.connect(makeConfig({ 'rule-1': deviceRule('ABB700A', 'https://hook.io/a') }));
  mockApi.emit('open', mockApi);
  await new Promise(r => setImmediate(r));

  channel.emit('outputDatapointChanged', PairingIds.AL_SWITCH_ON_OFF, '1');

  assert.equal(sender.calls.length, 1);
  assert.equal(sender.calls[0].url, 'https://hook.io/a');
  const p = sender.calls[0].payload as Record<string, unknown>;
  assert.equal(p['deviceSerial'], 'ABB700A');
  assert.equal(p['event'], 'outputDatapointChanged');
  assert.equal(p['value'], '1');
});

test('WebhookBridge: payload includes channelNumber, floor and room', async () => {
  const sender  = new SpySender();
  const mockApi = new MockApi();
  const { device, channel } = makeDeviceWithChannel('ABB700A', 'Light', { channelNumber: 3, floor: 1, room: 5 });
  mockApi.devices = [device];

  const bridge = new WebhookBridge(sender, () => mockApi as any);
  await bridge.connect(makeConfig({ 'rule-1': deviceRule('ABB700A', 'https://hook.io/a') }));
  mockApi.emit('open', mockApi);
  await new Promise(r => setImmediate(r));

  channel.emit('outputDatapointChanged', PairingIds.AL_SWITCH_ON_OFF, '1');

  const p = sender.calls[0].payload as Record<string, unknown>;
  assert.equal(p['channelNumber'], 3);
  assert.equal(p['floor'], 1);
  assert.equal(p['room'], 5);
});

test('WebhookBridge: floor and room are undefined when not set on channel', async () => {
  const sender  = new SpySender();
  const mockApi = new MockApi();
  const { device, channel } = makeDeviceWithChannel('ABB700A', 'Light');
  mockApi.devices = [device];

  const bridge = new WebhookBridge(sender, () => mockApi as any);
  await bridge.connect(makeConfig({ 'rule-1': deviceRule('ABB700A', 'https://hook.io/a') }));
  mockApi.emit('open', mockApi);
  await new Promise(r => setImmediate(r));

  channel.emit('outputDatapointChanged', PairingIds.AL_SWITCH_ON_OFF, '1');

  const p = sender.calls[0].payload as Record<string, unknown>;
  assert.equal(p['floor'], undefined);
  assert.equal(p['room'], undefined);
});

test('WebhookBridge: includes auth headers from rule', async () => {
  const sender  = new SpySender();
  const mockApi = new MockApi();
  const { device, channel } = makeDeviceWithChannel('ABB700A', 'Light');
  mockApi.devices = [device];

  const bridge = new WebhookBridge(sender, () => mockApi as any);
  await bridge.connect(makeConfig({
    'rule-1': {
      items: {
        deviceSerial: 'ABB700A',
        webhookUrl: 'https://hook.io/a',
        authHeaderName: 'Authorization',
        authHeaderValue: 'Bearer secret',
      },
      deletable: true,
    },
  }));
  mockApi.emit('open', mockApi);
  await new Promise(r => setImmediate(r));

  channel.emit('outputDatapointChanged', PairingIds.AL_SWITCH_ON_OFF, '1');

  assert.equal(sender.calls[0].headers['Authorization'], 'Bearer secret');
});

test('WebhookBridge: empty datapointFilter passes all datapoints', async () => {
  const sender  = new SpySender();
  const mockApi = new MockApi();
  const { device, channel } = makeDeviceWithChannel('ABB700A', 'Light');
  mockApi.devices = [device];

  const bridge = new WebhookBridge(sender, () => mockApi as any);
  await bridge.connect(makeConfig({ 'rule-1': deviceRule('ABB700A', 'https://hook.io/a', '') }));
  mockApi.emit('open', mockApi);
  await new Promise(r => setImmediate(r));

  channel.emit('outputDatapointChanged', PairingIds.AL_SWITCH_ON_OFF, '1');
  channel.emit('outputDatapointChanged', PairingIds.AL_INFO_ON_OFF, '0');

  assert.equal(sender.calls.length, 2);
});

test('WebhookBridge: datapointFilter only passes matching id', async () => {
  const sender  = new SpySender();
  const mockApi = new MockApi();
  const { device, channel } = makeDeviceWithChannel('ABB700A', 'Light');
  mockApi.devices = [device];

  const bridge = new WebhookBridge(sender, () => mockApi as any);
  await bridge.connect(makeConfig({
    'rule-1': deviceRule('ABB700A', 'https://hook.io/a', String(PairingIds.AL_SWITCH_ON_OFF)),
  }));
  mockApi.emit('open', mockApi);
  await new Promise(r => setImmediate(r));

  channel.emit('outputDatapointChanged', PairingIds.AL_INFO_ON_OFF, '0');   // filtered out
  channel.emit('outputDatapointChanged', PairingIds.AL_SWITCH_ON_OFF, '1'); // passes

  assert.equal(sender.calls.length, 1);
  const p = sender.calls[0].payload as Record<string, unknown>;
  assert.equal(p['datapointId'], PairingIds.AL_SWITCH_ON_OFF);
});

test('WebhookBridge: two rules for same device call both webhook URLs', async () => {
  const sender  = new SpySender();
  const mockApi = new MockApi();
  const { device, channel } = makeDeviceWithChannel('ABB700A', 'Light');
  mockApi.devices = [device];

  const bridge = new WebhookBridge(sender, () => mockApi as any);
  await bridge.connect(makeConfig({
    'rule-1': deviceRule('ABB700A', 'https://hook.io/a'),
    'rule-2': deviceRule('ABB700A', 'https://hook.io/b'),
  }));
  mockApi.emit('open', mockApi);
  await new Promise(r => setImmediate(r));

  channel.emit('outputDatapointChanged', PairingIds.AL_SWITCH_ON_OFF, '1');

  assert.equal(sender.calls.length, 2);
  const urls = sender.calls.map(c => c.url).sort();
  assert.deepEqual(urls, ['https://hook.io/a', 'https://hook.io/b']);
});

// ---------------------------------------------------------------------------
// Scene dispatch
// ---------------------------------------------------------------------------

function makeSceneMessage(sceneId: string, sceneData: object = {}): string {
  return JSON.stringify({
    'sysap-uuid': {
      datapoints: {},
      devices: {},
      devicesAdded: [],
      devicesRemoved: [],
      scenesTriggered: { [sceneId]: sceneData },
    },
  });
}

test('WebhookBridge: scene webhook fired when sceneTriggered message arrives', async () => {
  const sender  = new SpySender();
  const mockApi = new MockApi();

  const bridge = new WebhookBridge(sender, () => mockApi as any);
  await bridge.connect(makeConfig({ 'scene-1': sceneRule('sc1', 'https://hook.io/scene') }));
  mockApi.emit('open', mockApi);
  await new Promise(r => setImmediate(r));

  mockApi.websocket.emit('message', makeSceneMessage('sc1', { ch0000: {} }));

  assert.equal(sender.calls.length, 1);
  const p = sender.calls[0].payload as Record<string, unknown>;
  assert.equal(p['event'], 'sceneTriggered');
  assert.equal(p['sceneId'], 'sc1');
});

test('WebhookBridge: empty sceneId rule matches any scene', async () => {
  const sender  = new SpySender();
  const mockApi = new MockApi();

  const bridge = new WebhookBridge(sender, () => mockApi as any);
  await bridge.connect(makeConfig({ 'scene-1': sceneRule('', 'https://hook.io/all') }));
  mockApi.emit('open', mockApi);
  await new Promise(r => setImmediate(r));

  mockApi.websocket.emit('message', makeSceneMessage('sc-abc'));
  mockApi.websocket.emit('message', makeSceneMessage('sc-xyz'));

  assert.equal(sender.calls.length, 2);
});

test('WebhookBridge: specific sceneId rule only fires for that scene', async () => {
  const sender  = new SpySender();
  const mockApi = new MockApi();

  const bridge = new WebhookBridge(sender, () => mockApi as any);
  await bridge.connect(makeConfig({ 'scene-1': sceneRule('sc-match', 'https://hook.io/match') }));
  mockApi.emit('open', mockApi);
  await new Promise(r => setImmediate(r));

  mockApi.websocket.emit('message', makeSceneMessage('sc-other'));   // no match
  mockApi.websocket.emit('message', makeSceneMessage('sc-match'));   // matches

  assert.equal(sender.calls.length, 1);
  const p = sender.calls[0].payload as Record<string, unknown>;
  assert.equal(p['sceneId'], 'sc-match');
});

test('WebhookBridge: malformed WebSocket message does not throw', async () => {
  const sender  = new SpySender();
  const mockApi = new MockApi();

  const bridge = new WebhookBridge(sender, () => mockApi as any);
  await bridge.connect(makeConfig({ 'scene-1': sceneRule('', 'https://hook.io/all') }));
  mockApi.emit('open', mockApi);
  await new Promise(r => setImmediate(r));

  assert.doesNotThrow(() => {
    mockApi.websocket.emit('message', 'not valid json {{{{');
  });
  assert.equal(sender.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

test('WebhookBridge: disconnect() calls api.disconnect()', async () => {
  const sender  = new SpySender();
  const mockApi = new MockApi();

  const bridge = new WebhookBridge(sender, () => mockApi as any);
  await bridge.connect(makeConfig({ 'rule-1': deviceRule('ABB700A', 'https://hook.io/a') }));

  bridge.disconnect();

  assert.equal(mockApi.disconnectCalled, true);
});

test('WebhookBridge: disconnect() is safe when not connected', () => {
  const sender = new SpySender();
  const bridge = new WebhookBridge(sender, () => { throw new Error('should not be called'); });

  assert.doesNotThrow(() => bridge.disconnect());
});

test('WebhookBridge: second connect() disconnects previous API first', async () => {
  const sender   = new SpySender();
  const mockApi1 = new MockApi();
  const mockApi2 = new MockApi();
  let callCount  = 0;

  const bridge = new WebhookBridge(sender, () => {
    return (callCount++ === 0 ? mockApi1 : mockApi2) as any;
  });

  const config = makeConfig({ 'rule-1': deviceRule('ABB700A', 'https://hook.io/a') });
  await bridge.connect(config);
  await bridge.connect(config);

  assert.equal(mockApi1.disconnectCalled, true);
});
