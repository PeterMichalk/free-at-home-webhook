import { PairingIds } from '@busch-jaeger/free-at-home';
import { AddOn } from '@busch-jaeger/free-at-home';
import { WebhookRule, SceneRule } from './types';

export class RuleParser {
  /**
   * Parses a PairingId from a numeric string (e.g. "1") or an enum name
   * (e.g. "AL_SWITCH_ON_OFF"). Returns NaN for unrecognised values.
   */
  static parsePairingId(raw: string): number {
    if (!raw.trim()) return NaN;
    const n = Number(raw);
    if (!isNaN(n)) return n;
    const val = PairingIds[raw as keyof typeof PairingIds];
    return typeof val === 'number' ? val : NaN;
  }

  /**
   * Builds a map of deviceSerial → WebhookRule[] from the addon configuration.
   * Every configuration entry that is not "default" is treated as a webhook rule
   * instance (created by the "multiple: true" group in the metadata).
   */
  static buildRulesMap(configuration: AddOn.Configuration): Map<string, WebhookRule[]> {
    const rulesMap = new Map<string, WebhookRule[]>();

    for (const [key, entry] of Object.entries(configuration ?? {})) {
      if (key === 'default') continue;

      const items = entry?.items ?? {};
      const serial          = ((items['deviceSerial']  as string | undefined) ?? '').trim();
      const url             = ((items['webhookUrl']    as string | undefined) ?? '').trim();
      const authHeaderName  = ((items['authHeaderName']  as string | undefined) ?? '').trim();
      const authHeaderValue = ((items['authHeaderValue'] as string | undefined) ?? '').trim();
      const filterRaw       = ((items['datapointFilter'] as string | undefined) ?? '').trim();

      if (!serial || !url) continue;

      const extraHeaders: Record<string, string> = {};
      if (authHeaderName && authHeaderValue) {
        extraHeaders[authHeaderName] = authHeaderValue;
      }

      const datapointFilter = new Set<number>(
        filterRaw
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
          .map(RuleParser.parsePairingId)
          .filter(n => !isNaN(n))
      );

      const rule: WebhookRule = { url, extraHeaders, datapointFilter };
      const existing = rulesMap.get(serial);
      if (existing) {
        existing.push(rule);
      } else {
        rulesMap.set(serial, [rule]);
      }
    }

    return rulesMap;
  }

  /**
   * Builds the list of scene webhook rules from the addon configuration.
   * Scene rule entries are identified by the presence of the "sceneId" item key,
   * which is always present in "sceneRules" group instances (even when empty).
   */
  static buildSceneRules(configuration: AddOn.Configuration): SceneRule[] {
    const rules: SceneRule[] = [];

    for (const [key, entry] of Object.entries(configuration ?? {})) {
      if (key === 'default') continue;

      const items = entry?.items ?? {};
      if (!('sceneId' in items)) continue; // not a scene rule entry

      const url             = ((items['webhookUrl']    as string | undefined) ?? '').trim();
      const sceneId         = ((items['sceneId']       as string | undefined) ?? '').trim();
      const authHeaderName  = ((items['authHeaderName']  as string | undefined) ?? '').trim();
      const authHeaderValue = ((items['authHeaderValue'] as string | undefined) ?? '').trim();

      if (!url) continue;

      const extraHeaders: Record<string, string> = {};
      if (authHeaderName && authHeaderValue) {
        extraHeaders[authHeaderName] = authHeaderValue;
      }

      rules.push({ sceneId, url, extraHeaders });
    }

    return rules;
  }
}
