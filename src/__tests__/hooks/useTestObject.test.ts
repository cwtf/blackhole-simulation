import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTestObject } from "@/hooks/useTestObject";
import { WORLDLINE_STRIDE, type WorldlineAudit } from "@/physics/worldline";

const bridgeMocks = vi.hoisted(() => ({
  dropTestObject: vi.fn(),
  solveApsides: vi.fn(),
}));

vi.mock("@/engine/physics-bridge", () => ({
  physicsBridge: bridgeMocks,
}));

const AUDIT: WorldlineAudit = {
  energy: 1,
  angularMomentum: 0,
  energyDrift: 0,
  angularMomentumDrift: 0,
  properTime: 0,
  coordinateTime: 0,
  endReason: 0,
  sampleCount: 1,
};

describe("horizon handover playback", () => {
  beforeEach(() => {
    bridgeMocks.dropTestObject.mockReset();
    bridgeMocks.solveApsides.mockReset();
    bridgeMocks.solveApsides.mockRejectedValue(new Error("not initialized"));
    bridgeMocks.dropTestObject.mockResolvedValue({
      samples: new Float32Array(WORLDLINE_STRIDE),
      audit: AUDIT,
    });
  });

  it("stays paused when integration finishes until the caller starts the ride", async () => {
    const { result } = renderHook(() => useTestObject(1, 4.154e6, 0.5));

    act(() => {
      result.current.drop("radialFall", {
        r0: 2,
        innerRadius: 0.04,
        maxSteps: 800_000,
        startPaused: true,
      });
    });

    expect(result.current.paused).toBe(true);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.paused).toBe(true);
    expect(result.current.properTime).toBe(0);
    expect(bridgeMocks.dropTestObject).toHaveBeenCalledWith(
      expect.objectContaining({
        r0: 2,
        innerRadius: 0.04,
        maxSteps: 800_000,
      }),
    );
    expect(bridgeMocks.dropTestObject).not.toHaveBeenCalledWith(
      expect.objectContaining({ startPaused: expect.anything() }),
    );
  });
});
