"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  projectToScreen,
  screenToPlane,
  type CameraState,
} from "@/physics/camera-projection";
import {
  apsisHandlePositions,
  minorAxisHandlePositions,
  clampApsis,
  eccentricity,
  newtonianEllipse,
  normalizeAngle,
  orbitBasis,
  orderApsides,
  standardOrbitElements,
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
  const rollDrag = useRef({ x: 0, y: 0, screenX: 0, screenY: 0 });
  const axisDrag = useRef({ pointerAngle: 0, argument: 0 });

  useEffect(() => {
    let canvas: HTMLCanvasElement | null = null;
    const measure = () => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      setSize((current) =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      );
    };
    const resize = new ResizeObserver(measure);
    const findCanvas = () => {
      const next = document.querySelector("canvas");
      if (next === canvas) return;
      if (canvas) resize.unobserve(canvas);
      canvas = next;
      if (canvas) {
        resize.observe(canvas);
        measure();
      }
    };
    const observer = new MutationObserver(findCanvas);
    observer.observe(document.body, { childList: true, subtree: true });
    findCanvas();
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const {
    apsides,
    setApsides,
    apsidesSolution,
    draggingApsis,
    setDraggingApsis,
  } = object;

  useEffect(() => {
    if ((!enabled || object.view === "first") && draggingApsis)
      setDraggingApsis(null);
  }, [enabled, object.view, draggingApsis, setDraggingApsis]);

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
      const { node, transverse } = orbitBasis({
        ...apsides,
        ...standardOrbitElements(apsides),
        apsidalRotation: 0,
      });
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
    if (!draggingApsis || !enabled || object.view === "first") return undefined;

    const onMove = (e: PointerEvent) => {
      if (draggingApsis === "a" || draggingApsis === "b") {
        const target = {
          x: rollDrag.current.screenX + e.clientX - rollDrag.current.x,
          y: rollDrag.current.screenY + e.clientY - rollDrag.current.y,
        };
        // Fit the projected rotation arc, including edge-on views where a
        // ray/plane intersection would be singular. Prefer the current branch.
        let best = apsides.apsidalRotation;
        let score = Infinity;
        for (let i = 0; i <= 720; i++) {
          const angle = -Math.PI / 2 + (i * Math.PI) / 720;
          const points = minorAxisHandlePositions({
            ...apsides,
            apsidalRotation: angle,
          });
          const point = projectToScreen(
            points[draggingApsis],
            cam,
            size.width,
            size.height,
          );
          if (!point.visible) continue;
          const distance =
            (point.x - target.x) ** 2 +
            (point.y - target.y) ** 2 +
            0.05 * (angle - apsides.apsidalRotation) ** 2;
          if (distance < score) {
            score = distance;
            best = angle;
          }
        }
        setApsides({ ...apsides, apsidalRotation: best });
        return;
      }
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
    enabled,
    object.view,
    cam,
    size,
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
  const minorHandles = minorAxisHandlePositions(apsides);
  const aScreen = projectToScreen(minorHandles.a, cam, size.width, size.height);
  const bScreen = projectToScreen(minorHandles.b, cam, size.width, size.height);
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
            aria-label="Major axis · rotate orbit"
            stroke="transparent"
            strokeWidth={16}
            style={{
              pointerEvents: "stroke",
              cursor: "grab",
              touchAction: "none",
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const angle = angleInPlane(e.clientX, e.clientY);
              if (angle === null) return;
              axisDrag.current = {
                pointerAngle: angle,
                argument: standardOrbitElements(apsides).argument,
              };
              setApsides({
                ...apsides,
                ...standardOrbitElements(apsides),
                apsidalRotation: 0,
              });
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
        label="Periapsis · closest"
        radius={apsides.periapsis}
        colour={stroke}
        active={draggingApsis === "periapsis"}
        onGrab={() => setDraggingApsis("periapsis")}
      />
      <Handle
        point={apoScreen}
        label="Apoapsis · farthest"
        radius={apsides.apoapsis}
        colour={stroke}
        active={draggingApsis === "apoapsis"}
        onGrab={() => setDraggingApsis("apoapsis")}
      />

      {aScreen.visible && bScreen.visible && (
        <line
          x1={aScreen.x}
          y1={aScreen.y}
          x2={bScreen.x}
          y2={bScreen.y}
          stroke="rgba(216,180,254,0.6)"
          strokeDasharray="3 5"
        />
      )}
      {(
        [
          ["a", aScreen],
          ["b", bScreen],
        ] as const
      ).map(([key, point]) => (
        <Handle
          key={key}
          point={point}
          label={key.toUpperCase() + " · tilt orbit"}
          colour="rgb(216,180,254)"
          active={draggingApsis === key}
          onGrab={(event) => {
            rollDrag.current = {
              x: event.clientX,
              y: event.clientY,
              screenX: point.x,
              screenY: point.y,
            };
            setDraggingApsis(key);
          }}
        />
      ))}

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
  radius?: number;
  colour: string;
  active: boolean;
  onGrab: (event: React.PointerEvent<SVGCircleElement>) => void;
}) {
  if (!point.visible) return null;
  return (
    <g style={{ pointerEvents: "auto", cursor: "grab", touchAction: "none" }}>
      {/* A generous invisible target: the visible ring is 7px, which is a
          hard thing to hit on a touchscreen. */}
      <circle
        cx={point.x}
        cy={point.y}
        r={18}
        fill="transparent"
        aria-label={label}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onGrab(e);
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
        {label}
        {radius === undefined ? "" : ` ${radius.toFixed(1)} M`}
      </text>
    </g>
  );
}
