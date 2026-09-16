declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    /** Private Apps Script endpoint, including its access key. */
    DASHBOARD_SOURCE_URL?: string;
    WALLET_SOURCE_URL?: string;
  }
}
