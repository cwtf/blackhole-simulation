import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SpeedControl } from "@/components/fork/SpeedControl";
import type { UseTestObject } from "@/hooks/useTestObject";
import { speedToSlider } from "@/physics/playback";

function speedObject(overrides: Partial<UseTestObject> = {}): UseTestObject {
  return {
    speed: 10,
    setSpeed: vi.fn(),
    comfort: 60,
    paused: false,
    setPaused: vi.fn(),
    transportRate: 4,
    horizonSlowdown: 1,
    ...overrides,
  } as UseTestObject;
}

describe("speed control synchronization", () => {
  it("shows the bottom transport multiplier in the left slider and readout", () => {
    const object = speedObject();
    render(<SpeedControl object={object} />);

    const slider = screen.getByLabelText(
      "Playback speed multiplier",
    ) as HTMLInputElement;
    expect(Number(slider.value)).toBeCloseTo(speedToSlider(40), 6);
    expect(screen.getByText("40×")).not.toBeNull();
  });

  it("converts left slider changes back to the shared base speed", () => {
    const object = speedObject();
    render(<SpeedControl object={object} />);

    fireEvent.change(screen.getByLabelText("Playback speed multiplier"), {
      target: { value: String(speedToSlider(100)) },
    });
    expect(object.setSpeed).toHaveBeenCalledWith(25);

    fireEvent.click(screen.getByText("1× real time"));
    expect(object.setSpeed).toHaveBeenLastCalledWith(0.25);
  });

  it("shares rewind direction, horizon slowdown, and pause state", () => {
    const object = speedObject({
      paused: false,
      transportRate: -2,
      horizonSlowdown: 0.5,
    });
    render(<SpeedControl object={object} />);

    expect(screen.getByText("rewind 10×")).not.toBeNull();
    expect(
      screen.getByText(/Automatic horizon slowdown is active/),
    ).not.toBeNull();
    fireEvent.click(screen.getByText("pause"));
    expect(object.setPaused).toHaveBeenCalledWith(true);
  });
});
