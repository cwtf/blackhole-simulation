import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTestObject } from "@/hooks/useTestObject";
import {
  INTERIOR_CUTOFF_PER_MASS,
  WORLDLINE_END,
  WORLDLINE_STRIDE,
  type WorldlineAudit,
} from "@/physics/worldline";
import { interiorCutoff } from "@/physics/tidal";

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
    // Whatever `interiorCutoff` decides for this hole — derived, not restated, so
    // the two cannot drift apart. What matters here is only that it is a real
    // radius strictly inside the horizon.
    expect(request.innerRadius).toBeCloseTo(
      interiorCutoff(mass, 4.154e6, INTERIOR_CUTOFF_PER_MASS),
      12,
    );
    expect(request.innerRadius).toBeGreaterThan(0);
    expect(request.innerRadius).toBeLessThan(2 * mass);
    expect(request.maxSteps).toBe(800_000);
  });

  /**
   * A ride that bounces off the Kerr barrier must not claim it arrived.
   *
   * It used to: the diverged run reported `endReason` 0 with a final r of
   * −6.47, which the old `isInteriorEndpoint` accepted, so the "reached the
   * singularity" card appeared over a frozen frame at a radius *outside* the
   * hole. Both flags are checked, because getting one right and the other wrong
   * is how it looked correct in passing.
   */
  it.each([
    {
      name: "a bounce inside the horizon",
      endReason: WORLDLINE_END.reachedTurningPoint,
      r: 0.535,
      expectArrival: false,
      expectReversal: true,
    },
    {
      name: "a genuine arrival at the cutoff",
      endReason: WORLDLINE_END.reachedInnerRadius,
      r: 0.039,
      expectArrival: true,
      expectReversal: false,
    },
    {
      name: "a run that stopped at the horizon",
      endReason: WORLDLINE_END.reachedInnerRadius,
      r: 1.87,
      expectArrival: false,
      expectReversal: false,
    },
  ])(
    "classifies $name",
    async ({ endReason, r, expectArrival, expectReversal }) => {
      // One sample at tau = 0 so the playback clock is already at the end.
      const samples = new Float32Array(WORLDLINE_STRIDE);
      samples[3] = r;
      bridgeMocks.dropTestObject.mockResolvedValue({
        samples,
        audit: { ...AUDIT, endReason },
      });

      const { result } = renderHook(() => useTestObject(1, 4.154e6, 0.9));
      act(() => {
        result.current.drop("radialFall", { r0: 2 });
      });
      await waitFor(() => expect(result.current.status).toBe("ready"));
      act(() => {
        result.current.setView("first");
      });

      expect(result.current.reachedSingularity).toBe(expectArrival);
      expect(result.current.reversedInsideHorizon).toBe(expectReversal);
      // Never both.
      expect(
        result.current.reachedSingularity &&
          result.current.reversedInsideHorizon,
      ).toBe(false);
    },
  );

  it("does not call a diverged negative radius an arrival", async () => {
    const samples = new Float32Array(WORLDLINE_STRIDE);
    samples[3] = -6.47; // what the old integrator left in the buffer
    bridgeMocks.dropTestObject.mockResolvedValue({
      samples,
      audit: { ...AUDIT, endReason: WORLDLINE_END.reachedInnerRadius },
    });

    const { result } = renderHook(() => useTestObject(1, 4.154e6, 0.9));
    act(() => {
      result.current.drop("radialFall", { r0: 2 });
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => {
      result.current.setView("first");
    });

    expect(result.current.reachedSingularity).toBe(false);
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

  it("steps rewind and fast-forward rates like a media transport", () => {
    const { result } = renderHook(() => useTestObject(1, 4.154e6, 0.5));

    act(() => result.current.stepTransport(-1));
    expect(result.current.transportRate).toBe(-1);
    act(() => result.current.stepTransport(-1));
    expect(result.current.transportRate).toBe(-2);
    act(() => result.current.stepTransport(1));
    expect(result.current.transportRate).toBe(1);
    act(() => result.current.stepTransport(1));
    expect(result.current.transportRate).toBe(2);
    expect(result.current.paused).toBe(false);
  });

  it("seeks by normalized proper time and keeps the clocks aligned", async () => {
    const samples = new Float32Array(WORLDLINE_STRIDE * 2);
    samples[3] = 3;
    samples[WORLDLINE_STRIDE] = 10;
    samples[WORLDLINE_STRIDE + 1] = 12;
    samples[WORLDLINE_STRIDE + 2] = 20;
    samples[WORLDLINE_STRIDE + 3] = 1;
    bridgeMocks.dropTestObject.mockResolvedValue({ samples, audit: AUDIT });
    const { result } = renderHook(() => useTestObject(1, 4.154e6, 0));

    act(() => result.current.drop("radialFall", { r0: 3 }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.seekTrajectory(0.5));

    expect(result.current.properTime).toBeCloseTo(5, 6);
    expect(result.current.farTime).toBeCloseTo(10, 6);
    expect(result.current.trajectoryProgress).toBeCloseTo(0.5, 6);
    expect(result.current.crossesEventHorizon).toBe(true);
    expect(result.current.eventHorizonProgress).toBeCloseTo(0.5, 6);
  });
});
