export class WebhookSender {
  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly sleepFn: (ms: number) => Promise<void> = ms =>
      new Promise(resolve => setTimeout(resolve, ms)),
    private readonly maxRetries = 3,
    private readonly baseDelayMs = 1000
  ) {}

  async send(
    url: string,
    extraHeaders: Record<string, string>,
    payload: object
  ): Promise<void> {
    const headers = { 'Content-Type': 'application/json', ...extraHeaders };
    let delay = this.baseDelayMs;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.fetchFn(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        if (response.ok) {
          console.log(`Webhook sent → ${url} (HTTP ${response.status})`);
          return;
        }
        console.warn(
          `Webhook attempt ${attempt}/${this.maxRetries} failed → ${url} (HTTP ${response.status})`
        );
      } catch (err) {
        console.warn(`Webhook attempt ${attempt}/${this.maxRetries} error → ${url}:`, err);
      }

      if (attempt < this.maxRetries) {
        await this.sleepFn(delay);
        delay *= 2;
      }
    }

    console.error(`Webhook failed after ${this.maxRetries} attempts → ${url}`);
  }
}
