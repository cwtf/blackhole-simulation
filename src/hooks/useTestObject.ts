"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { physicsBridge, type ApsidesSolution } from "@/engine/physics-bridge";
import {
  DEFAULT_APSIDES,
  orderApsides,
  standardOrbitElements,
  type ApsisPair,
} from "@/physics/apsides";
import {
  orientFrame,
  tetradToCartesian,
  type CartesianLeg,
} from "@/physics/first-person";
import { geometricRatePerSecond } from "@/physics/playback";
import { suitStrain } from "@/physics/tidal";
import {
  comfortSpeed,
  durationToSeconds,
  radiusToKm,
  tidalAccelerationG,
  timeUnitSeconds,
} from "@/configs/mass-presets";
import {
  DEFAULT_DROP_RADIUS,
  Worldline,
  buildDropRequest,
  interiorDropOptions,
  isInteriorEndpoint,
  WORLDLINE_END,
  type DropOptions,
  type DropPresetName,
} from "@/physics/worldline";

/**
 * Dropped test object: integration, playback clock, and readouts (spec §1.5).
 *
 * The worldline is integrated **once** per drop; playback
 * only advances a clock and looks the position up. That is what keeps the
 * two camera views consistent (§1.6) and what will make the §1.9 speed slider
 * a pure playback control that cannot alter the trajectory.
 */

/**
 * Ratio of distant-observer clock rate to proper-time clock rate.
 *
 * Both views advance from the same wall-clock tick and the same speed
 * multiplier; this only reflects that a distant observer's clock runs ahead of
 * the rider's. Kept at 1 so the multiplier means exactly what §1.9 says it
 * means — the actual dilation is already baked into the worldline, and
 * applying it again here would double-count it.
 */
const OBSERVER_CLOCK_RATIO = 1.0;

export interface TestObjectReadout {
  /** Radius in Schwarzschild radii. */
  rOverRs: number;
  /** The object's own clock. */
  tau: number;
  /** Distant observer's clock; diverges as the object nears the horizon. */
  tFar: number;
  /** Kerr-Schild coordinate time. */
  t: number;
  /**
   * Speed measured by a local static observer, as a fraction of c. Derived
   * from the conserved energy: gamma_local = E / sqrt(1 - r_s/r).
   */
  localVelocity: number;
  /** Tidal stretching per unit separation, 2M/r^3 in geometric units. */
  tidal: number;
  /** Emitted/observed frequency ratio, 0 at the horizon. Drives the fade. */
  redshift: number;

  // Physical units (§1.5, §1.8). The render is mass-invariant; only these
  // change with the preset.
  /** Radius in kilometres. */
  rKm: number;
  /** Proper time in seconds. */
  tauSeconds: number;
  /** Distant-observer time in seconds; Infinity at and inside the horizon. */
  tFarSeconds: number;
  /** Tidal stretch across 1 m, in Earth gravities. */
  tidalG: number;
}

/** Which camera the simulation is being watched from (spec §1.6). */
export type ViewMode = "third" | "first";

export interface TestObjectDropOptions extends DropOptions {
  /** Hold a newly integrated line at tau=0 until its caller finishes setup. */
  startPaused?: boolean;
}

/**
 * The rider's frame, resolved for the renderer.
 *
 * Legs are `[x, y, z, e^t]`: spatial part in the shader's Cartesian axes with
 * the contravariant time component that carries the frequency shift. Free-look
 * remains a local-space rotation so it cannot break tetrad orthonormality.
 */
export interface FirstPersonFrame {
  pos: [number, number, number];
  e0: [number, number, number, number];
  e1: [number, number, number, number];
  e2: [number, number, number, number];
  e3: [number, number, number, number];
  look: [number, number, number, number];
  /**
   * Draw the rider's own suit in the lower half of the frame.
   *
   * The suit is at rest in this frame, so it is the one thing on screen that
   * is neither lensed nor shifted — which is exactly what makes it useful as
   * well as legible. It can still be switched off for an unobstructed view.
   */
  showBody: boolean;
  /**
   * Tidal deformation of the suit as `[transverse, radial]` scale factors, both
   * 1 until the tide exceeds what the body can hold together (spec §1.6).
   *
   * The one quantity in this frame that depends on the mass preset rather than
   * on r/r_s alone — see `physics/tidal.ts`.
   */
  strain: [number, number];
}

export interface UseTestObject {
  worldline: Worldline | null;
  status: "idle" | "integrating" | "ready" | "error";
  error: string | null;
  /** Current distant-observer time being displayed. */
  farTime: number;
  /** Current proper time along the object's own clock (1st person). */
  properTime: number;
  paused: boolean;
  setPaused: (p: boolean) => void;
  /** Playback multiplier: simulated seconds per wall-clock second (§1.9). */
  speed: number;
  setSpeed: (s: number) => void;
  /** Per-preset comfort speed, the labelled default detent. */
  comfort: number;
  view: ViewMode;
  /** 1st person is only meaningful while an object is on a worldline. */
  setView: (v: ViewMode) => void;
  canRideAlong: boolean;
  /** Free-look, applied inside the frame. Radians. */
  look: { yaw: number; pitch: number };
  addLook: (dYaw: number, dPitch: number) => void;
  /** Whether the rider's suit is drawn in 1st person. */
  showSuit: boolean;
  setShowSuit: (s: boolean) => void;
  /** Null in 3rd person; the rider's frame otherwise. */
  firstPersonFrame: FirstPersonFrame | null;
  /** True once the rider has reached the singularity. */
  reachedSingularity: boolean;
  /**
   * True once the rider's fall reversed inside the horizon and the worldline
   * ended at the turning point rather than at the singularity. Mutually
   * exclusive with `reachedSingularity`.
   */
  reversedInsideHorizon: boolean;
  drop: (preset: DropPresetName, options?: TestObjectDropOptions) => void;
  reset: () => void;
  readout: TestObjectReadout | null;

  // --- Draggable apsides (spec §6.3, milestone 9) ---
  /** The pair the handles currently describe, in M. */
  apsides: ApsisPair;
  /** Move a handle. Live during the drag; nothing is integrated yet. */
  setApsides: (pair: ApsisPair) => void;
  /**
   * The Rust solver's verdict on the current pair — bound orbit or capture,
   * and where the separatrix is. Null until the first answer arrives; it lags
   * the drag by a worker round trip, which is milliseconds.
   */
  apsidesSolution: ApsidesSolution | null;
  /** True while a handle is held, which is what puts the preview on screen. */
  draggingApsis: "periapsis" | "apoapsis" | "axis" | null;
  setDraggingApsis: (which: "periapsis" | "apoapsis" | "axis" | null) => void;
  /**
   * Apsides the last integration actually reached, in M. Compared against the
   * request in the panel, because agreeing with the trajectory is the only
   * claim worth making.
   */
  measuredApsides: { min: number; max: number } | null;
}

export function useTestObject(
  mass: number,
  solarMasses: number,
  /**
   * Dimensionless spin. Not used by the playback maths — it is here so §6.3's
   * apsides classification is re-asked when the geometry changes. A separatrix
   * computed for a* = 0.9 and displayed next to a a* = 0.5 hole is exactly the
   * kind of quietly-wrong number this project keeps having to dig out.
   */
  spin: number,
): UseTestObject {
  const [worldline, setWorldline] = useState<Worldline | null>(null);
  const [status, setStatus] = useState<UseTestObject["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [farTime, setFarTime] = useState(0);
  const [properTime, setProperTime] = useState(0);
  const [paused, setPaused] = useState(false);
  const [view, setViewInternal] = useState<ViewMode>("third");
  const [look, setLook] = useState({ yaw: 0, pitch: 0 });
  // On by default: the 1st-person view is a spacewalk, and a spacewalk with no
  // body attached to the eye reads as a floating camera. Off is still one click
  // away for anyone measuring the sky rather than riding it.
  const [showSuit, setShowSuit] = useState(true);

  // §1.9: default to the per-preset comfort speed, recomputed whenever the
  // mass preset changes — one ISCO orbit in ~30 s of wall clock, whatever the
  // hole. Explicitly set speeds survive a preset change only until the user
  // has not touched the slider.
  const [speed, setSpeed] = useState(() => comfortSpeed(solarMasses));
  const speedTouched = useRef(false);

  useEffect(() => {
    if (!speedTouched.current) setSpeed(comfortSpeed(solarMasses));
  }, [solarMasses]);

  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number>(0);
  const dropRequestRef = useRef(0);

  // §6.3: the dragged pair. Kept here rather than in the panel so the overlay
  // (which draws the handles) and the panel (which reads them out) see one
  // source of truth, and so a drop can use them without prop-drilling.
  const [apsides, setApsidesInternal] = useState<ApsisPair>(DEFAULT_APSIDES);
  const [apsidesSolution, setApsidesSolution] =
    useState<ApsidesSolution | null>(null);
  const [draggingApsis, setDraggingApsis] = useState<
    "periapsis" | "apoapsis" | "axis" | null
  >(null);

  const setApsides = useCallback((pair: ApsisPair) => {
    setApsidesInternal(orderApsides(pair.periapsis, pair.apoapsis, pair));
  }, []);

  // Ask Rust what the current pair is. Latest-wins rather than debounced: the
  // solve is microseconds and the round trip is the only cost, so dropping
  // stale answers is simpler than throttling and never leaves the panel
  // showing a verdict for a pair the user has already moved past.
  const apsidesRequest = useRef(0);
  useEffect(() => {
    const token = ++apsidesRequest.current;
    let cancelled = false;
    const orientation = standardOrbitElements(apsides);
    physicsBridge
      .solveApsides(
        apsides.periapsis,
        apsides.apoapsis,
        orientation.inclination,
      )
      .then((solution) => {
        if (cancelled || token !== apsidesRequest.current) return;
        setApsidesSolution(solution);
      })
      .catch(() => {
        // The engine may not be up yet on the first render; the next drag
        // asks again. A failed classification must not block the drag.
      });
    return () => {
      cancelled = true;
    };
    // mass and spin are dependencies even though they are not arguments: the
    // solver reads the engine's current metric, so the answer changes when
    // they do. `usePhysicsState` pushes them to the engine from a child
    // component, whose effects React runs before this parent one, so by the
    // time this fires the engine already has the new geometry.
  }, [apsides, mass, spin]);

  const drop = useCallback(
    (preset: DropPresetName, options?: TestObjectDropOptions) => {
      const token = ++dropRequestRef.current;
      const { startPaused = false, ...requestOptions } = options ?? {};
      setStatus("integrating");
      setError(null);
      setWorldline(null);
      setFarTime(0);
      setProperTime(0);
      setPaused(startPaused);
      setLook({ yaw: 0, pitch: 0 });

      // Every worldline is integrated through the horizon to the interior
      // cutoff, not stopped just outside r_h.
      //
      // `buildDropRequest` defaults `innerRadius` to 0, which the Rust side
      // reads as r_h * 1.001 — the right stopping point for a view that cannot
      // see further in, and the wrong one for a buffer that both views share.
      // The panel's Drop button passed no `innerRadius`, so riding one of its
      // objects ran out of worldline *at the event horizon*: proper time hit
      // `totalProperTime`, the clamp below pinned it there, and the 1st-person
      // camera froze on the last sample. That looked exactly like the
      // 3rd-person dilation freeze and was nothing of the kind — the samples
      // simply stopped.
      //
      // Extending every drop inward costs the 3rd-person view nothing:
      // interior samples carry t_far = Infinity, so `sampleByFarTime` clamps
      // to `lastVisibleIndex` and never reaches them. Bound orbits never get
      // near the cutoff, and `max_orbits` still ends them, so the raised step
      // budget is a ceiling rather than a cost.
      //
      // An explicit `innerRadius`/`maxSteps` from the caller still wins — the
      // horizon handover in SimulatorApp sets its own.
      const request = buildDropRequest(preset, {
        ...interiorDropOptions(
          mass,
          requestOptions.r0 ?? DEFAULT_DROP_RADIUS,
          solarMasses,
        ),
        ...requestOptions,
      });
      physicsBridge
        .dropTestObject(request)
        .then(({ samples, audit }) => {
          if (token !== dropRequestRef.current) return;
          const line = new Worldline(samples, audit);
          setWorldline(line);
          setStatus("ready");

          // Spec §1.5: conservation is monitored, and a breach is reported
          // rather than silently rendered.
          if (!line.conserved) {
            // eslint-disable-next-line no-console
            console.warn(
              `Worldline conservation drift exceeded 1e-6: dE = ${audit.energyDrift.toExponential(3)}, ` +
                `dL = ${audit.angularMomentumDrift.toExponential(3)}`,
            );
          }
        })
        .catch((err: unknown) => {
          if (token !== dropRequestRef.current) return;
          setStatus("error");
          setError(err instanceof Error ? err.message : String(err));
        });
    },
    // Both masses scale the interior cutoff — `mass` sets its ceiling and
    // `solarMasses` sets how deep the rider's body survives — so a drop
    // integrated for one hole must not be reused for another.
    [mass, solarMasses],
  );

  const reset = useCallback(() => {
    ++dropRequestRef.current;
    setWorldline(null);
    setStatus("idle");
    setError(null);
    setFarTime(0);
    setProperTime(0);
    setPaused(false);
    setLook({ yaw: 0, pitch: 0 });
    // Riding an object that no longer exists is not a state the UI should be
    // able to reach.
    setViewInternal("third");
  }, []);

  const addLook = useCallback((dYaw: number, dPitch: number) => {
    setLook((prev) => ({
      yaw: prev.yaw + dYaw,
      // Clamp pitch just shy of the poles so the view cannot flip over.
      pitch: Math.max(
        -Math.PI / 2 + 0.01,
        Math.min(Math.PI / 2 - 0.01, prev.pitch + dPitch),
      ),
    }));
  }, []);

  // Playback clock. Advances the DISTANT OBSERVER's time, which is what the
  // 3rd-person view is parameterised by (§1.6).
  useEffect(() => {
    if (!worldline || paused) return undefined;

    lastRef.current = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;

      // §1.9: the multiplier scales the simulation clock against wall clock
      // and never touches the physics. The worldline was integrated once at
      // drop time; this only changes which sample gets looked up, so the same
      // drop replayed at any speed traces an identical trajectory.
      const rate = geometricRatePerSecond(speed, timeUnitSeconds(solarMasses));

      // Both clocks advance from the same wall-clock tick, but they index the
      // one stored worldline by different parameters (§1.6). Advancing both
      // keeps a view switch continuous rather than jumping.
      setFarTime((prev) => prev + dt * rate * OBSERVER_CLOCK_RATIO);
      setProperTime((prev) =>
        Math.min(prev + dt * rate, worldline.totalProperTime),
      );
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [worldline, paused, speed, solarMasses]);

  // §1.9: Space toggles pause. Ignored while typing so it cannot hijack a
  // form field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      setPaused((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const canRideAlong = !!worldline && worldline.count > 0;
  const setView = useCallback(
    (v: ViewMode) => {
      if (v === "first" && !canRideAlong) return;
      setViewInternal(v);
    },
    [canRideAlong],
  );

  // The 1st-person view rides the object, so it samples by proper time; the
  // 3rd-person view watches from far away and samples by the distant
  // observer's clock. Same buffer, two parameters.
  const ridePoint =
    worldline && worldline.count > 0
      ? worldline.sampleByProperTime(properTime)
      : null;

  // "Ran out of worldline" is not the same as "reached the singularity". A
  // stable circular orbit exhausts its step budget with the object still
  // happily orbiting; announcing an arrival there would be a lie. Require the
  // integration to have actually terminated at the inner radius
  // (endReason 0 = ReachedInnerRadius) at the explicit interior cutoff. The
  // old `r < 2M` check mislabeled the outer Kerr horizon as the singularity.
  const rideEnded =
    !!ridePoint && !!worldline && properTime >= worldline.totalProperTime;

  const reachedSingularity =
    rideEnded &&
    !!worldline &&
    !!ridePoint &&
    worldline.audit.endReason === WORLDLINE_END.reachedInnerRadius &&
    isInteriorEndpoint(ridePoint.r, mass);

  // The other way an interior ride can end (spec §1.6): the fall reversed.
  //
  // A spinning hole has a barrier 2M a² E² for a zero-angular-momentum
  // infaller, so the handover's release from rest at 1.02 r_+ — E ≈ 0.08 at
  // a* = 0.9 — turns around at r ≈ 0.535 instead of reaching the cutoff. The
  // rider then heads back out toward the inner horizon, which ingoing
  // Kerr-Schild cannot follow it across, so the worldline stops there.
  //
  // This has to be distinguishable from an arrival. It used to be reported as
  // one: the diverged run ended with `endReason` 0 and r = −6.47, which the old
  // `isInteriorEndpoint` accepted, so the "reached the singularity" card
  // appeared for a rider that had bounced and then overflowed.
  const reversedInsideHorizon =
    rideEnded &&
    !!worldline &&
    worldline.audit.endReason === WORLDLINE_END.reachedTurningPoint;

  let firstPersonFrame: FirstPersonFrame | null = null;
  if (view === "first" && ridePoint && worldline) {
    const cart = tetradToCartesian(
      ridePoint.tetrad,
      ridePoint.r,
      ridePoint.theta,
      ridePoint.phi,
    );
    const resolve = (
      leg: CartesianLeg,
      sign: number,
    ): [number, number, number, number] => {
      return [
        leg.spatial[0] * sign,
        leg.spatial[1] * sign,
        leg.spatial[2] * sign,
        leg.time * sign,
      ];
    };

    // The camera's right/up/forward are identified by what the legs physically
    // are, not by the order Gram-Schmidt produced them in. Forward is inward
    // radial so the hole is in shot when the ride starts.
    const axes = orientFrame(ridePoint.tetrad);
    const legs: CartesianLeg[] = [cart.e0, cart.e1, cart.e2, cart.e3];

    const pos = worldline.toCartesian(ridePoint);
    firstPersonFrame = {
      pos,
      // e0 is the observer's own 4-velocity: it must NOT be rotated by
      // free-look, or looking around would change where you are going.
      e0: [
        cart.e0.spatial[0],
        cart.e0.spatial[1],
        cart.e0.spatial[2],
        cart.e0.time,
      ],
      e1: resolve(legs[axes.right.index]!, axes.right.sign),
      e2: resolve(legs[axes.up.index]!, axes.up.sign),
      e3: resolve(legs[axes.forward.index]!, axes.forward.sign),
      look: quaternionFromYawPitch(look.yaw, look.pitch),
      showBody: showSuit,
      // Depends on solarMasses, not on mass: the failure radius is set by the
      // tide in SI units, so the same r/r_s is survivable at one scale and not
      // at another.
      strain: (() => {
        const s = suitStrain(ridePoint.r, solarMasses);
        return [s.transverse, s.radial];
      })(),
    };
  }

  let readout: TestObjectReadout | null = null;
  if (worldline && worldline.count > 0) {
    const p =
      view === "first"
        ? worldline.sampleByProperTime(properTime)
        : worldline.sampleByFarTime(farTime);
    const rs = 2 * mass;
    const lapse = Math.max(1e-9, 1 - rs / p.r);
    const e = worldline.audit.energy;
    // gamma_local = E / sqrt(1 - r_s/r)  =>  v = sqrt(1 - 1/gamma^2)
    const gamma = e / Math.sqrt(lapse);
    const localVelocity = gamma > 1 ? Math.sqrt(1 - 1 / (gamma * gamma)) : 0;

    readout = {
      rOverRs: p.r / rs,
      tau: p.tau,
      tFar: p.tFar,
      t: p.t,
      localVelocity,
      tidal: (2 * mass) / (p.r * p.r * p.r),
      redshift: worldline.redshiftFactor(p.r, rs),
      rKm: radiusToKm(p.r, solarMasses),
      tauSeconds: durationToSeconds(p.tau, solarMasses),
      tFarSeconds: Number.isFinite(p.tFar)
        ? durationToSeconds(p.tFar, solarMasses)
        : Infinity,
      tidalG: tidalAccelerationG(p.r, solarMasses, 1),
    };
  }

  return {
    worldline,
    status,
    error,
    farTime,
    properTime,
    paused,
    setPaused,
    speed,
    setSpeed: (s: number) => {
      speedTouched.current = true;
      setSpeed(s);
    },
    comfort: comfortSpeed(solarMasses),
    view,
    setView,
    canRideAlong,
    look,
    addLook,
    showSuit,
    setShowSuit,
    firstPersonFrame,
    reachedSingularity,
    reversedInsideHorizon,
    drop,
    reset,
    readout,
    apsides,
    setApsides,
    apsidesSolution,
    draggingApsis,
    setDraggingApsis,
    measuredApsides: worldline ? worldline.radialExtent() : null,
  };
}

/**
 * Yaw about the frame's up axis, then pitch about its right axis.
 *
 * Composed in that order so pitch stays relative to the horizon the observer
 * sees rather than accumulating roll — the same convention as an ordinary
 * free-look camera.
 */
function quaternionFromYawPitch(
  yaw: number,
  pitch: number,
): [number, number, number, number] {
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2);
  const sp = Math.sin(pitch / 2);
  // q = qYaw (about y) * qPitch (about x)
  return [cy * sp, sy * cp, -sy * sp, cy * cp];
}
