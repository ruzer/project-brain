import { describe, expect, it } from "vitest";

import { deriveAdaptiveQueueBudget, deriveResourcePressure, deriveSplitGroupSize } from "../../core/swarm_runtime/index";

describe("swarm runtime budgeting", () => {
  it("classifies resource pressure from load and free memory", () => {
    expect(deriveResourcePressure({ cpuCount: 8, loadAverage1m: 1.5, freeMemoryMb: 4096 })).toBe("low");
    expect(deriveResourcePressure({ cpuCount: 8, loadAverage1m: 4.5, freeMemoryMb: 4096 })).toBe("medium");
    expect(deriveResourcePressure({ cpuCount: 8, loadAverage1m: 7.2, freeMemoryMb: 4096 })).toBe("high");
    expect(deriveResourcePressure({ cpuCount: 8, loadAverage1m: 1.5, freeMemoryMb: 900 })).toBe("high");
  });

  it("shrinks the default queue budget under machine pressure", () => {
    expect(deriveAdaptiveQueueBudget({ selected: 4, cpuCount: 8, loadAverage1m: 1.5, freeMemoryMb: 4096 })).toBe(16);
    expect(deriveAdaptiveQueueBudget({ selected: 3, cpuCount: 8, loadAverage1m: 4.8, freeMemoryMb: 4096 })).toBe(9);
    expect(deriveAdaptiveQueueBudget({ selected: 2, cpuCount: 8, loadAverage1m: 7.2, freeMemoryMb: 900 })).toBe(6);
  });

  it("shrinks split group size under higher pressure and local-budget runs", () => {
    expect(deriveSplitGroupSize("low", false)).toBe(4);
    expect(deriveSplitGroupSize("medium", false)).toBe(3);
    expect(deriveSplitGroupSize("high", false)).toBe(2);
    expect(deriveSplitGroupSize("low", true)).toBe(3);
    expect(deriveSplitGroupSize("medium", true)).toBe(2);
    expect(deriveSplitGroupSize("high", true)).toBe(1);
  });
});
