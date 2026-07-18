import { describe, expect, it } from "vitest";

import {
  BaseRpcConfigurationError,
  resolveBaseRpcUrls,
} from "./client";

describe("Base RPC configuration", () => {
  it("uses Base's official endpoint for local development", () => {
    expect(resolveBaseRpcUrls({ NODE_ENV: "development" })).toEqual([
      "https://mainnet.base.org",
    ]);
  });

  it("deduplicates a dedicated primary and public failover", () => {
    expect(
      resolveBaseRpcUrls({
        NODE_ENV: "production",
        BASE_RPC_HTTP_URLS:
          " https://api.developer.coinbase.com/rpc/v1/base/test-key, https://mainnet.base.org ",
        BASE_RPC_HTTP_URL: "https://mainnet.base.org",
      }),
    ).toEqual([
      "https://api.developer.coinbase.com/rpc/v1/base/test-key",
      "https://mainnet.base.org",
    ]);
  });

  it("rejects a public-only production configuration", () => {
    expect(() =>
      resolveBaseRpcUrls({
        NODE_ENV: "production",
        BASE_RPC_HTTP_URL: "https://mainnet.base.org",
      }),
    ).toThrowError(BaseRpcConfigurationError);
  });

  it("rejects insecure production transports", () => {
    expect(() =>
      resolveBaseRpcUrls({
        NODE_ENV: "production",
        BASE_RPC_HTTP_URL: "http://rpc.example.com",
      }),
    ).toThrowError("Base RPC URLs must use HTTPS in production.");
  });
});
