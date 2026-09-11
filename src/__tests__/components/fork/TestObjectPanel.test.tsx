import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestObjectPanel } from "@/components/fork/TestObjectPanel";
import { DropPositionPreview } from "@/components/fork/TestObjectOverlay";
import type { UseTestObject } from "@/hooks/useTestObject";
import { findPreset, DEFAULT_MASS_PRESET } from "@/configs/mass-presets";
vi.mock("@/components/fork/SpeedControl", () => ({ SpeedControl: () => null }));
vi.mock("@/components/fork/ViewToggle", () => ({ ViewToggle: () => null }));
afterEach(cleanup);
beforeEach(() => {
  window.matchMedia = vi
    .fn()
    .mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
});
function props() {
  return {
    object: {
      status: "idle",
      worldline: null,
      view: "third",
      drop: vi.fn(),
      reset: vi.fn(),
      setView: vi.fn(),
      setPaused: vi.fn(),
    } as unknown as UseTestObject,
    isVisible: true,
    editing: true,
    onEditingChange: vi.fn(),
    r0: 20,
    onRadiusChange: vi.fn(),
    massPresetId: DEFAULT_MASS_PRESET,
    massPreset: findPreset(DEFAULT_MASS_PRESET),
    onMassPresetChange: vi.fn(),
    realObject: null,
    realObjectLocked: false,
    onSelectRealObject: vi.fn(),
    onRestoreRealObject: vi.fn(),
    preset: "radialFall" as const,
    onPresetChange: vi.fn(),
  };
}
describe("simplified drop controls", () => {
  it("selects behaviours and shares distance with the preview state", () => {
    const p = props();
    render(<TestObjectPanel {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Orbit" }));
    expect(p.onPresetChange).toHaveBeenCalledWith("circular");
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(p.onPresetChange).toHaveBeenCalledWith("apsides");
    fireEvent.change(
      screen.getByLabelText("Distance from black hole in units of M"),
      { target: { value: "42" } },
    );
    expect(p.onRadiusChange).toHaveBeenCalledWith(42);
  });
  it("launches once and retries the saved setup after editing distance", () => {
    const p = props();
    const { rerender } = render(<TestObjectPanel {...p} />);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(p.object.drop).toHaveBeenCalledWith("radialFall", {
      r0: 20,
      tangentialFraction: 1,
    });
    expect(p.onEditingChange).toHaveBeenCalledWith(false);
    rerender(
      <TestObjectPanel
        {...p}
        r0={80}
        editing={false}
        object={{
          ...p.object,
          status: "ready",
          worldline: {} as UseTestObject["worldline"],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry · R" }));
    expect(p.object.drop).toHaveBeenLastCalledWith("radialFall", {
      r0: 20,
      tangentialFraction: 1,
    });
  });
  it("ignores shortcut keys while adjusting inputs and while integrating", () => {
    const p = props();
    const { rerender } = render(<TestObjectPanel {...p} />);
    fireEvent.keyDown(
      screen.getByLabelText("Distance from black hole in units of M"),
      { key: "Enter" },
    );
    expect(p.object.drop).not.toHaveBeenCalled();
    rerender(
      <TestObjectPanel
        {...p}
        object={{ ...p.object, status: "integrating" }}
      />,
    );
    fireEvent.keyDown(window, { key: "Enter" });
    expect(p.object.drop).not.toHaveBeenCalled();
  });
  it("cancels placement and keeps secondary sections collapsed", () => {
    const p = props();
    render(<TestObjectPanel {...p} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(p.onEditingChange).toHaveBeenCalledWith(false);
    expect(screen.getByText("Advanced settings").closest("details")?.open).toBe(
      false,
    );
    expect(
      screen.getByText("Black hole & appearance").closest("details")?.open,
    ).toBe(false);
  });
  it("moves the ghost with radius and gives guidance outside the viewport", () => {
    const { container, rerender } = render(
      <DropPositionPreview
        radius={7}
        mouse={{ x: 0.5, y: 0.5 }}
        zoom={30}
        width={1000}
        height={800}
      />,
    );
    const x = container.querySelector("circle")?.getAttribute("cx");
    rerender(
      <DropPositionPreview
        radius={12}
        mouse={{ x: 0.5, y: 0.5 }}
        zoom={30}
        width={1000}
        height={800}
      />,
    );
    expect(container.querySelector("circle")?.getAttribute("cx")).not.toBe(x);
    rerender(
      <DropPositionPreview
        radius={300}
        mouse={{ x: 0.5, y: 0.5 }}
        zoom={30}
        width={1000}
        height={800}
      />,
    );
    expect(screen.getByText(/Launch position off-screen/)).not.toBeNull();
  });
});
