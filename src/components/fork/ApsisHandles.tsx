"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  projectToScreen,
  screenToPlane,
  type CameraState,
} from "@/physics/camera-projection";
import {
  apsisHandlePositions,
  clampApsis,
  eccentricity,
  newtonianEllipse,
  normalizeAngle,
  orbitBasis,
  orderApsides,
} from "@/physics/apsides";
import type { UseTestObject } from "@/hooks/useTestObject";

/**
 * Dragging changes the setup only; the panel's Launch action integrates it.
 * The dashed Newtonian ellipse is an approximate preview, not the actual
 * relativistic trajectory. Solver-backed capture feedback remains visible.
 * Sliders in Advanced settings provide an alternative when the plane is edge-on.
 */
export function ApsisHandles({
  object,
  mouse,
  zoom,
  enabled,
}: {
  object: UseTestObject;
  mouse: { x: number; y: number };
  zoom: number;
  /** Only shown while the apsides trajectory is selected. */
  enabled: boolean;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const axisDrag = useRef({ pointerAngle: 0, argument: 0 });

  useEffect(() => {
    const measure = () => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const {
    apsides,
    setApsides,
    apsidesSolution,
    draggingApsis,
    setDraggingApsis,
  } = object;

  // Memoised because the pointer-move listener closes over it: a fresh object
  // each render would tear down and re-register the drag handlers on every
  // frame of the drag.
  const cam: CameraState = useMemo(
    () => ({ mouseX: mouse.x, mouseY: mouse.y, zoom }),
    [mouse.x, mouse.y, zoom],
  );

  // The drag reads the pointer against the canvas, so it must not care where
  // the SVG happens to be laid out.
  const pointAt = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const hit = screenToPlane(
        { x: clientX - rect.left, y: clientY - rect.top },
        cam,
        {
          width: rect.width,
          height: rect.height,
          normal: orbitBasis(apsides).normal,
        },
      );
      return hit;
    },
    [cam, apsides],
  );

  const angleInPlane = useCallback(
    (clientX: number, clientY: number): number | null => {
      const hit = pointAt(clientX, clientY);
      if (!hit) return null;
      const { node, transverse } = orbitBasis(apsides);
      const dot = (
        v: [number, number, number],
        basis: [number, number, number],
      ) => v[0] * basis[0] + v[1] * basis[1] + v[2] * basis[2];
      return Math.atan2(dot(hit.world, transverse), dot(hit.world, node));
    },
    [apsides, pointAt],
  );

  // Pointer capture lives on window, not the handle: a fast drag leaves the
  // 9px circle behind long before the pointer stops, and losing the drag
  // there would make the handles feel broken rather than precise.
  useEffect(() => {
    if (!draggingApsis) return undefined;

    const onMove = (e: PointerEvent) => {
      if (draggingApsis === "axis") {
        const angle = angleInPlane(e.clientX, e.clientY);
        if (angle === null) return;
        setApsides({
          ...apsides,
          argument: normalizeAngle(
            axisDrag.current.argument + angle - axisDrag.current.pointerAngle,
          ),
        });
        return;
      }
      const hit = pointAt(e.clientX, e.clientY);
      if (!hit) return;
      const r = clampApsis(hit.radius);
      setApsides(
        draggingApsis === "periapsis"
          ? orderApsides(r, apsides.apoapsis, apsides)
          : orderApsides(apsides.periapsis, r, apsides),
      );
    };
    const onUp = () => {
      setDraggingApsis(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [
    draggingApsis,
    pointAt,
    angleInPlane,
    setApsides,
    setDraggingApsis,
    apsides,
  ]);

  if (!enabled || size.width === 0) return null;
  // In 1st person the camera is the object; there is no external orbit to grab.
  if (object.view === "first") return null;

  const handles = apsisHandlePositions(apsides);
  const periScreen = projectToScreen(
    handles.periapsis,
    cam,
    size.width,
    size.height,
  );
  const apoScreen = projectToScreen(
    handles.apoapsis,
    cam,
    size.width,
    size.height,
  );

  const captures = apsidesSolution?.plunges ?? false;
  const stroke = captures
    ? "rgba(255, 110, 90, 0.75)"
    : "rgba(120, 220, 255, 0.6)";

  const ellipse = newtonianEllipse(apsides, 192)
    .map((p) => projectToScreen(p, cam, size.width, size.height))
    .filter((p) => p.visible)
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  const label = captures
    ? `CAPTURE · no bound orbit reaches ${apsides.periapsis.toFixed(1)} M from ${apsides.apoapsis.toFixed(1)} M`
    : `e = ${eccentricity(apsides).toFixed(3)}`;

  const visibleAnchors = [periScreen, apoScreen].filter((p) => p.visible);
  const clamp = (value: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, value));
  const captionX = clamp(
    visibleAnchors.reduce((sum, p) => sum + p.x, 0) /
      Math.max(1, visibleAnchors.length),
    200,
    size.width - 200,
  );
  const captionY = clamp(
    (visibleAnchors[0]?.y ?? size.height / 2) - 34,
    24,
    size.height - 24,
  );

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 z-30"
      width={size.width}
      height={size.height}
      // The SVG itself must not eat canvas drags — only the handles do.
      style={{ pointerEvents: "none" }}
    >
      {ellipse && (
        <polyline
          points={ellipse}
          fill="none"
          stroke={stroke}
          strokeWidth={1}
          strokeDasharray="5 4"
        />
      )}

      {/* The line of apsides, so the two handles read as one control. */}
      {periScreen.visible && apoScreen.visible && (
        <>
          <line
            x1={periScreen.x}
            y1={periScreen.y}
            x2={apoScreen.x}
            y2={apoScreen.y}
            stroke="transparent"
            strokeWidth={16}
            style={{ pointerEvents: "stroke", cursor: "grab" }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const angle = angleInPlane(e.clientX, e.clientY);
              if (angle === null) return;
              axisDrag.current = {
                pointerAngle: angle,
                argument: apsides.argument,
              };
              setDraggingApsis("axis");
            }}
          />
          <line
            x1={periScreen.x}
            y1={periScreen.y}
            x2={apoScreen.x}
            y2={apoScreen.y}
            stroke={stroke}
            strokeWidth={draggingApsis === "axis" ? 1.5 : 0.75}
            strokeDasharray="2 6"
          />
        </>
      )}

      <Handle
        point={periScreen}
        label="Closest"
        radius={apsides.periapsis}
        colour={stroke}
        active={draggingApsis === "periapsis"}
        onGrab={() => setDraggingApsis("periapsis")}
      />
      <Handle
        point={apoScreen}
        label="Farthest"
        radius={apsides.apoapsis}
        colour={stroke}
        active={draggingApsis === "apoapsis"}
        onGrab={() => setDraggingApsis("apoapsis")}
      />

      {/* The caption is NOT gated on the drag. An unlabelled dashed ellipse
          sitting next to the integrated trail is exactly the kind of thing
          that gets read as the orbit — and it is not one: it closes, and the
          real trajectory precesses. Saying so while the two are on screen
          together is the whole point (§6.3, and the honesty rule in §6).

          Anchored to the midpoint of the two handles and clamped into the
          frame, because a wide orbit puts the apoapsis off-screen and a
          caption that says "no bound orbit reaches…" is worthless clipped. */}
      {(periScreen.visible || apoScreen.visible) && (
        <text
          x={captionX}
          y={captionY}
          textAnchor="middle"
          className="font-mono"
          fontSize={9}
          fill={captures ? "rgba(255,150,130,0.95)" : "rgba(255,255,255,0.7)"}
        >
          {label}
          <tspan
            x={captionX}
            dy={11}
            fill="rgba(255,255,255,0.4)"
            fontSize={7.5}
          >
            {draggingApsis
              ? "APPROXIMATE PREVIEW — RELEASE TO PLACE"
              : "NEWTONIAN PREVIEW — THE INTEGRATED ORBIT PRECESSES"}
          </tspan>
        </text>
      )}
    </svg>
  );
}

function Handle({
  point,
  label,
  radius,
  colour,
  active,
  onGrab,
}: {
  point: { x: number; y: number; visible: boolean };
  label: string;
  radius: number;
  colour: string;
  active: boolean;
  onGrab: () => void;
}) {
  if (!point.visible) return null;
  return (
    <g style={{ pointerEvents: "auto", cursor: "grab" }}>
      {/* A generous invisible target: the visible ring is 7px, which is a
          hard thing to hit on a touchscreen. */}
      <circle
        cx={point.x}
        cy={point.y}
        r={18}
        fill="transparent"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onGrab();
        }}
      />
      <circle
        cx={point.x}
        cy={point.y}
        r={active ? 9 : 7}
        fill="rgba(0,0,0,0.35)"
        stroke={colour}
        strokeWidth={active ? 2 : 1.25}
        pointerEvents="none"
      />
      <text
        x={point.x}
        y={point.y + 20}
        textAnchor="middle"
        className="font-mono"
        fontSize={8}
        fill="rgba(255,255,255,0.55)"
        pointerEvents="none"
      >
        {label} {radius.toFixed(1)} M
      </text>
    </g>
  );
}
