export interface WebhookRule {
  url: string;
  extraHeaders: Record<string, string>;
  datapointFilter: Set<number>; // empty = all datapoints pass through
}

export interface SceneRule {
  sceneId: string; // empty = all scenes
  url: string;
  extraHeaders: Record<string, string>;
}
