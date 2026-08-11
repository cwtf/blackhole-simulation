import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TrajectoryPlayback } from "@/components/fork/TrajectoryPlayback";
import type { UseTestObject } from "@/hooks/useTestObject";
import { WORLDLINE_STRIDE, Worldline } from "@/physics/worldline";

function playbackObject(overrides: Partial<UseTestObject> = {}): UseTestObject {
  const samples = new Float32Array(WORLDLINE_STRIDE * 2);
  samples[3] = 3;
  samples[WORLDLINE_STRIDE] = 10;
  samples[WORLDLINE_STRIDE + 3] = 1;
  const worldline = new Worldline(samples, {
    energy: 1,
    angularMomentum: 0,
    energyDrift: 0,
    angularMomentumDrift: 0,
    properTime: 10,
    coordinateTime: 10,
    endReason: 0,
    sampleCount: 2,
  });

  return {
    view: "first",
    worldline,
    properTime: 5,
    paused: false,
    setPaused: vi.fn(),
    speed: 1,
    transportRate: 1,
    stepTransport: vi.fn(),
    playForward: vi.fn(),
    trajectoryProgress: 0.5,
    seekTrajectory: vi.fn(),
    crossesEventHorizon: true,
    eventHorizonProgress: 0.5,
    horizonSlowdown: 1,
    ...overrides,
  } as UseTestObject;
}

describe("trajectory playback", () => {
  it("only renders for a first-person horizon-crossing trajectory", () => {
    const { rerender } = render(
      <TrajectoryPlayback object={playbackObject({ view: "third" })} />,
    );
    expect(screen.queryByLabelText("Trajectory progress")).toBeNull();

    rerender(
      <TrajectoryPlayback
        object={playbackObject({ crossesEventHorizon: false })}
      />,
    );
    expect(screen.queryByLabelText("Trajectory progress")).toBeNull();

    rerender(<TrajectoryPlayback object={playbackObject()} />);
    expect(screen.getByLabelText("Trajectory progress")).not.toBeNull();
  });

  it("seeks and operates rewind, pause, and fast-forward", () => {
    const object = playbackObject();
    render(<TrajectoryPlayback object={object} />);

    fireEvent.change(screen.getByLabelText("Trajectory progress"), {
      target: { value: "0.25" },
    });
    fireEvent.click(screen.getByLabelText("Rewind"));
    fireEvent.click(screen.getByLabelText("Pause"));
    fireEvent.click(screen.getByLabelText("Fast forward"));

    expect(object.seekTrajectory).toHaveBeenCalledWith(0.25);
    expect(object.stepTransport).toHaveBeenNthCalledWith(1, -1);
    expect(object.stepTransport).toHaveBeenNthCalledWith(2, 1);
    expect(object.setPaused).toHaveBeenCalledWith(true);
  });

  it("uses the play control to resume forward playback", () => {
    const object = playbackObject({ paused: true, transportRate: -4 });
    render(<TrajectoryPlayback object={object} />);
    fireEvent.click(screen.getByLabelText("Play"));
    expect(object.playForward).toHaveBeenCalledOnce();
  });
});
