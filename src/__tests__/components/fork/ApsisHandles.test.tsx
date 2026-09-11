import React, { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApsisHandles } from "@/components/fork/ApsisHandles";
import {
  DEFAULT_APSIDES,
  minorAxisHandlePositions,
  apsisHandlePositions,
  type ApsisPair,
  standardOrbitElements,
  orbitBasis,
} from "@/physics/apsides";
import { projectToScreen } from "@/physics/camera-projection";
import { buildDropRequest } from "@/physics/worldline";
import type { UseTestObject } from "@/hooks/useTestObject";
const cam = { mouseX: 0.62, mouseY: 0.34, zoom: 40 };
const changed = vi.fn();
function Harness() {
  const [pair, setPair] = useState(DEFAULT_APSIDES);
  const [dragging, setDragging] =
    useState<UseTestObject["draggingApsis"]>(null);
  return (
    <ApsisHandles
      enabled
      mouse={{ x: cam.mouseX, y: cam.mouseY }}
      zoom={cam.zoom}
      object={
        {
          apsides: pair,
          setApsides: (p: ApsisPair) => {
            changed(p);
            setPair(p);
          },
          draggingApsis: dragging,
          setDraggingApsis: setDragging,
          view: "third",
          apsidesSolution: null,
        } as UseTestObject
      }
    />
  );
}
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  changed.mockClear();
  vi.stubGlobal("PointerEvent", MouseEvent);
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () =>
    ({ width: 1000, height: 800, left: 0, top: 0 }) as DOMRect;
  document.body.appendChild(canvas);
});
afterEach(() => {
  cleanup();
  document.querySelector("canvas")?.remove();
  vi.unstubAllGlobals();
});
describe("3D orbit handles", () => {
  it("shows the preview when the canvas mounts after the controls", async () => {
    const canvas = document.querySelector("canvas");
    if (!canvas) throw Error("test canvas missing");
    canvas.remove();
    render(<Harness />);
    expect(screen.queryByLabelText("A · tilt orbit")).toBeNull();
    document.body.appendChild(canvas);
    await waitFor(() =>
      expect(screen.getByLabelText("A · tilt orbit")).not.toBeNull(),
    );
  });

  it("resizes periapsis without rotating the orbit", () => {
    render(<Harness />);
    const start = projectToScreen(
      apsisHandlePositions(DEFAULT_APSIDES).periapsis,
      cam,
      1000,
      800,
    );
    const target = projectToScreen([-14, 0, 0], cam, 1000, 800);
    fireEvent.pointerDown(screen.getByLabelText("Periapsis · closest"), {
      clientX: start.x,
      clientY: start.y,
    });
    fireEvent.pointerMove(window, { clientX: target.x, clientY: target.y });
    const pair = changed.mock.lastCall?.[0] as ApsisPair;
    expect(pair.periapsis).toBeCloseTo(14, 5);
    expect(pair.apoapsis).toBe(20);
    expect(pair.argument).toBe(0);
  });
  it("rotates the major axis without changing orbit size", () => {
    render(<Harness />);
    const start = projectToScreen([5, 0, 0], cam, 1000, 800);
    const target = projectToScreen(
      [5 * Math.cos(0.4), 0, 5 * Math.sin(0.4)],
      cam,
      1000,
      800,
    );
    fireEvent.pointerDown(screen.getByLabelText("Major axis · rotate orbit"), {
      clientX: start.x,
      clientY: start.y,
    });
    fireEvent.pointerMove(window, { clientX: target.x, clientY: target.y });
    const pair = changed.mock.lastCall?.[0] as ApsisPair;
    expect(pair.argument).toBeCloseTo(0.4, 5);
    expect(pair.periapsis).toBe(10);
    expect(pair.apoapsis).toBe(20);
  });

  for (const key of ["a", "b"] as const)
    it(`drags ${key.toUpperCase()} to tilt without changing either apsis`, () => {
      render(<Harness />);
      const start = projectToScreen(
        minorAxisHandlePositions(DEFAULT_APSIDES)[key],
        cam,
        1000,
        800,
      );
      const target = projectToScreen(
        minorAxisHandlePositions({
          ...DEFAULT_APSIDES,
          apsidalRotation: Math.PI / 6,
        })[key],
        cam,
        1000,
        800,
      );
      fireEvent.pointerDown(
        screen.getByLabelText(key.toUpperCase() + " · tilt orbit"),
        { clientX: start.x, clientY: start.y },
      );
      fireEvent.pointerMove(window, { clientX: target.x, clientY: target.y });
      const pair = changed.mock.lastCall?.[0] as ApsisPair;
      expect(pair.apsidalRotation).toBeCloseTo(Math.PI / 6, 2);
      expect(apsisHandlePositions(pair)).toEqual(
        apsisHandlePositions(DEFAULT_APSIDES),
      );
      const request = buildDropRequest("apsides", pair);
      expect(request.inclination).toBeCloseTo(
        standardOrbitElements(pair).inclination,
        8,
      );
      fireEvent.pointerUp(window);
      changed.mockClear();
      fireEvent.pointerMove(window, {
        clientX: target.x + 20,
        clientY: target.y,
      });
      expect(changed).not.toHaveBeenCalled();
    });
  it("positions A/B on the ellipse centred between the apsides", () => {
    const pair = {
      ...DEFAULT_APSIDES,
      argument: 0.6,
      inclination: 0.4,
      ascendingNode: 0.3,
      apsidalRotation: 0.7,
    };
    const { a, b } = minorAxisHandlePositions(pair);
    const ends = apsisHandlePositions(pair);
    const basis = orbitBasis(pair);
    for (let i = 0; i < 3; i++)
      expect(((a[i] ?? 0) + (b[i] ?? 0)) / 2).toBeCloseTo(
        ((ends.apoapsis[i] ?? 0) + (ends.periapsis[i] ?? 0)) / 2,
        10,
      );
    const dot = (v: number[], w: number[]) =>
      v.reduce((sum, x, i) => sum + x * (w[i] ?? 0), 0);
    expect(
      dot(
        a.map((x, i) => x - (b[i] ?? 0)),
        basis.major,
      ),
    ).toBeCloseTo(0, 10);
    expect(Math.hypot(...a.map((x, i) => (x - (b[i] ?? 0)) / 2))).toBeCloseTo(
      Math.sqrt(pair.apoapsis * pair.periapsis),
      10,
    );
  });
});
