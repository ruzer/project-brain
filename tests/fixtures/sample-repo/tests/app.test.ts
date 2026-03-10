import { describe, expect, it } from "vitest";

import { boot } from "../src/index";

describe("fixture", () => {
  it("boots", () => {
    expect(boot()).toBe("ok");
  });
});
