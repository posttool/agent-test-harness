import { defineConfig } from "vitest/config";

// Live tests call real model APIs and cost money. They run only via `npm run test:live`
// and skip themselves when the matching API key is not set.
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.live.test.ts"],
    testTimeout: 120_000,
  },
});
