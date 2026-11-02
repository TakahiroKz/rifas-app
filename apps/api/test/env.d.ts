import type { D1Migration } from "@cloudflare/vitest-plugin";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      ASSETS: Fetcher;
      TEST_MIGRATIONS: D1Migration[];
      REQUIRE_TURNSTILE?: string;
      TURNSTILE_SECRET?: string;
      TURNSTILE_SITE_KEY?: string;
      RESERVE_LIMITER?: RateLimit;
    }
  }
}
