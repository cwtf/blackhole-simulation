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

  /**
   * The panel's Drop button passes only { r0, tangentialFraction }. When that
   * left `innerRadius` unset, `buildDropRequest` sent 0, which the Rust side
   * reads as r_h * 1.001 — so the worldline stopped at the event horizon and
   * riding it froze there the instant proper time hit `totalProperTime`. Every
   * drop must be integrated to the interior cutoff, whether or not the caller
   * thought to ask, because the 1st-person view can ride any of them.
   */
  it("integrates every drop through the horizon, not just to it", async () => {
    const mass = 2;
    const { result } = renderHook(() => useTestObject(mass, 4.154e6, 0.5));

    act(() => {
      // Exactly what TestObjectPanel's Drop button sends.
      result.current.drop("radialFall", { r0: 20, tangentialFraction: 1 });
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));

    const request = bridgeMocks.dropTestObject.mock.calls[0]?.[0];
    expect(request.r0).toBe(20);
    // 0.04 * mass, and strictly inside the horizon rather than at it.
    expect(request.innerRadius).toBeCloseTo(0.08, 10);
    expect(request.innerRadius).toBeGreaterThan(0);
    expect(request.innerRadius).toBeLessThan(2 * mass);
    expect(request.maxSteps).toBe(800_000);
  });

  it("lets an explicit innerRadius from the handover win", async () => {
    const { result } = renderHook(() => useTestObject(1, 4.154e6, 0.5));

    act(() => {
      result.current.drop("radialFall", { r0: 3, innerRadius: 0.01 });
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(bridgeMocks.dropTestObject).toHaveBeenCalledWith(
      expect.objectContaining({ r0: 3, innerRadius: 0.01 }),
    );
  });
});
