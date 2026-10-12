declare namespace Cloudflare {
  interface Env {
    BUCKET?: R2Bucket;
    DB?: D1Database; // Optional starter type only; no D1 binding is provisioned.
  }
}
