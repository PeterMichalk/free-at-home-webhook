import { FreeAtHomeApi, PairingIds, ApiChannel } from '@busch-jaeger/free-at-home';
import { AddOn } from '@busch-jaeger/free-at-home';
import { SceneRule } from './types';
import { RuleParser } from './ruleParser';
import { WebhookSender } from './webhookSender';

export class WebhookBridge {
  private currentApi: FreeAtHomeApi | null = null;

  constructor(
    private readonly sender: WebhookSender = new WebhookSender(),
    private readonly apiFactory: (url: string, auth: object) => FreeAtHomeApi = (url, auth) =>
      new FreeAtHomeApi(url, auth)
  ) {}

  async connect(configuration: AddOn.Configuration): Promise<void> {
    this.disconnect();

    const defaultItems = configuration?.default?.items ?? {};
    const sysApUrl = (defaultItems['sysApUrl'] as string) || 'http://localhost';
    const username = (defaultItems['username'] as string) || '';
    const password = (defaultItems['password'] as string) || '';

    if (!username || !password) {
      console.log('No credentials configured – skipping SysAP connection.');
      return;
    }

    const rulesMap   = RuleParser.buildRulesMap(configuration);
    const sceneRules = RuleParser.buildSceneRules(configuration);

    if (rulesMap.size === 0 && sceneRules.length === 0) {
      console.log('No webhook rules configured – skipping SysAP connection.');
      return;
    }

    const authHeader = {
      Authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
    };

    const api = this.apiFactory(sysApUrl, authHeader);
    this.currentApi = api;

    api.on('open', async (connectedApi: FreeAtHomeApi) => {
      console.log(`Connected to SysAP at ${sysApUrl}`);

      const devices = await connectedApi.getAllDevices();

      for (const device of devices) {
        const rules = rulesMap.get(device.serialNumber);
        if (!rules?.length) continue;

        console.log(`Monitoring: ${device.serialNumber} – ${device.displayName ?? '(unnamed)'}`);

        for (const channel of device.getChannels()) {
          channel.on('outputDatapointChanged', (id: PairingIds, value: string) => {
            const payload = {
              timestamp:     new Date().toISOString(),
              deviceSerial:  device.serialNumber,
              deviceName:    device.displayName ?? device.serialNumber,
              channelNumber: channel.channelNumber,
              floor:         channel.floor,
              room:          channel.room,
              event:         'outputDatapointChanged',
              datapointId:   id,
              datapointName: PairingIds[id] ?? String(id),
              value,
            };

            for (const rule of rules) {
              if (rule.datapointFilter.size > 0 && !rule.datapointFilter.has(id)) continue;
              this.sender.send(rule.url, rule.extraHeaders, payload);
            }
          });
        }
      }

      this.attachSceneListener(connectedApi, sceneRules);
    });

    api.on('close', (code: number, reason: string) => {
      console.log(`Disconnected from SysAP (code: ${code}, reason: ${reason})`);
    });
  }

  private attachSceneListener(api: FreeAtHomeApi, rules: SceneRule[]): void {
    if (rules.length === 0) return;

    api.websocket.on('message', (raw: unknown) => {
      let message: Record<string, { scenesTriggered?: Record<string, unknown> }>;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }

      for (const sysapData of Object.values(message)) {
        for (const [sceneId, sceneData] of Object.entries(sysapData.scenesTriggered ?? {})) {
          const matching = rules.filter(r => r.sceneId === '' || r.sceneId === sceneId);
          if (matching.length === 0) continue;

          const payload = {
            timestamp: new Date().toISOString(),
            event:     'sceneTriggered',
            sceneId,
            scene:     sceneData,
          };

          for (const rule of matching) {
            this.sender.send(rule.url, rule.extraHeaders, payload);
          }
        }
      }
    });
  }

  disconnect(): void {
    if (this.currentApi !== null) {
      this.currentApi.disconnect();
      this.currentApi = null;
    }
  }
}
