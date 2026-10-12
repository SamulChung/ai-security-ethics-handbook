declare namespace Cloudflare {
  interface Env {
    BUCKET?: R2Bucket;
    HANDBOOK_MATERIALS_ALLOWED_EMAILS?: string;
    DB?: D1Database; // Optional starter type only; no D1 binding is provisioned.
  }
}
