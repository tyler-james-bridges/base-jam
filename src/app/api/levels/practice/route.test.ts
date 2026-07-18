import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("practice level API", () => {
  it("returns a deterministic unranked manifest without calling Base", async () => {
    const response = await GET(
      new Request("http://localhost/api/levels/practice?block=999999999999"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      level: {
        chainId: 8453,
        ranked: false,
        source: {
          kind: "practice",
          number: expect.stringMatching(/-for-999999999999$/),
        },
      },
      warning: "You chose the deterministic practice plate.",
    });
  });

  it("rejects malformed requested block identifiers", async () => {
    const response = await GET(
      new Request("http://localhost/api/levels/practice?block=not-a-block"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_BLOCK_NUMBER" },
    });
  });
});
