"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { DropPresetName } from "@/physics/worldline";
import { standardOrbitElements } from "@/physics/apsides";
import type { UseTestObject } from "@/hooks/useTestObject";
import { ViewToggle } from "./ViewToggle";
import { SpeedControl } from "./SpeedControl";
import { PowerControl } from "./PowerControl";
import type { SimulationParams } from "@/types/simulation";
import {
  MASS_PRESETS,
  type MassPreset,
  formatDuration,
  formatLength,
  iscoPeriodSeconds,
  peakDiskTemperatureK,
  schwarzschildRadiusKm,
} from "@/configs/mass-presets";
import {
  REAL_BLACK_HOLES,
  type RealBlackHole,
} from "@/configs/real-black-holes";
import { RealObjectCard } from "./RealObjectCard";

/**
 * Drop panel + test-object HUD (spec §1.5, §2.4).
 *
 * Styled in the base's control-panel idiom (liquid glass,
 * mono micro-type) rather than as a sidebar row.
 * never share a page.
 */

const PRESETS: { key: DropPresetName; label: string; hint: string }[] = [
  {
    key: "circular",
    label: "Circular orbit",
    hint: "Circular orbit. Drag its handles to customise the shape and 3D tilt.",
  },
  {
    key: "isco",
    label: "Edge of stability (ISCO)",
    hint: "Start at the edge of a stable orbit.",
  },
  {
    key: "eccentric",
    label: "Stretched orbit",
    hint: "An elongated orbit that shifts with each lap.",
  },
  {
    key: "radialFall",
    label: "Drop straight in",
    hint: "Release from rest and fall toward the black hole.",
  },
  // §6.3: an addition, not a replacement — the presets stay.
  {
    key: "apsides",
    label: "Custom orbit (drag points)",
    hint: "drag the two handles on the disk plane",
  },
];

const SMALL_SCREEN_QUERY = "(max-width: 767px)";

export function TestObjectPanel({
  object,
  isVisible,
  massPresetId,
  massPreset,
  onMassPresetChange,
  realObject,
  realObjectLocked,
  onSelectRealObject,
  onRestoreRealObject,
  params,
  onParamsChange,
  preset,
  onPresetChange,
  r0,
  editing,
  onEditingChange,
  onRadiusChange: setR0,
}: {
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  r0: number;
  onRadiusChange: (radius: number) => void;
  object: UseTestObject;
  isVisible: boolean;
  massPresetId: string;
  /**
   * Resolved preset, which is *not* always `findPreset(massPresetId)`: with a
   * real object selected it is synthesized from that object's mass, so the
   * r_s / ISCO / temperature rows below describe M87* rather than falling back
   * to the stellar default.
   */
  massPreset: MassPreset;
  onMassPresetChange: (id: string) => void;
  /** §6.4: the real object this session is locked to, if any. */
  realObject: RealBlackHole | null;
  realObjectLocked: boolean;
  onSelectRealObject: (id: string) => void;
  onRestoreRealObject: () => void;
  params?: SimulationParams;
  onParamsChange?: (patch: Partial<SimulationParams>) => void;
  /** Lifted so the overlay knows whether to draw the drag handles (§6.3). */
  preset: DropPresetName;
  onPresetChange: (preset: DropPresetName) => void;
}) {
  const [isCollapsed, setIsCollapsed] = useState<boolean | null>(null);

  useEffect(() => {
    const smallScreen = window.matchMedia(SMALL_SCREEN_QUERY);
    const applyResponsiveDefault = (
      event: MediaQueryListEvent | MediaQueryList,
    ) => setIsCollapsed(event.matches);

    applyResponsiveDefault(smallScreen);
    smallScreen.addEventListener("change", applyResponsiveDefault);
    return () =>
      smallScreen.removeEventListener("change", applyResponsiveDefault);
  }, []);

  const lastLaunch = useRef<Parameters<UseTestObject["drop"]> | null>(null);
  const launch = useCallback(() => {
    if (object.status === "integrating") return;
    const options =
      preset === "apsides"
        ? {
            r0: object.apsides.apoapsis,
            rPeri: object.apsides.periapsis,
            argument: object.apsides.argument,
            inclination: object.apsides.inclination,
            ascendingNode: object.apsides.ascendingNode,
            apsidalRotation: object.apsides.apsidalRotation,
          }
        : { r0, tangentialFraction: preset === "eccentric" ? 0.9 : 1 };
    lastLaunch.current = [preset, options];
    onEditingChange(false);
    object.drop(preset, options);
  }, [object, preset, r0, onEditingChange]);
  const retry = useCallback(() => {
    if (object.status === "integrating" || !lastLaunch.current) return;
    onEditingChange(false);
    object.drop(...lastLaunch.current);
  }, [object, onEditingChange]);
  useEffect(() => {
    if (!isVisible) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        e.defaultPrevented ||
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        target.closest?.(
          "input, select, textarea, button, summary, [contenteditable=true], [role=dialog]",
        )
      )
        return;
      if (e.key === "Enter" && editing) {
        e.preventDefault();
        launch();
      }
      if (e.key.toLowerCase() === "r" && object.worldline) {
        e.preventDefault();
        retry();
      }
      if (e.key === "Escape" && editing) {
        e.preventDefault();
        onEditingChange(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isVisible, editing, launch, retry, object.worldline, onEditingChange]);

  if (!isVisible) return null;

  const { readout, status, error, worldline } = object;

  // §6.4: one control, two kinds of entry. The synthetic presets are shapes of
  // black hole ("a stellar one"); the real objects are named things with
  // citations. Prefixing the option values keeps them from colliding — a
  // future preset called "sgra" would otherwise silently shadow Sgr A*.
  const selection = realObject
    ? `real:${realObject.id}`
    : `preset:${massPresetId}`;

  const handleSelection = (value: string) => {
    if (value.startsWith("real:")) onSelectRealObject(value.slice(5));
    else onMassPresetChange(value.slice(7));
  };

  const toggleCollapsed = () => {
    setIsCollapsed((collapsed) =>
      collapsed === null
        ? !window.matchMedia(SMALL_SCREEN_QUERY).matches
        : !collapsed,
    );
  };

  // Within 1% of the physical peak counts as true colour; the slider's 1000 K
  // step cannot land exactly on 1.11e7.
  const physicalPeakK = peakDiskTemperatureK(massPreset.solarMasses);
  const trueColour =
    !!params &&
    Math.abs(params.diskTemp - physicalPeakK) / physicalPeakK < 0.01;

  return (
    // top-48 clears the identity HUD stack above it: back pill, logo, title,
    // and the "SIMULATION KERNEL / METRIC" status lines. At top-28 this panel
    // overprinted them — caught by the first golden capture, not by any test.
    // The panel grew past the viewport once the mass-preset and speed
    // sections landed, colliding with the bottom bar. Cap it and let it
    // scroll rather than letting sections disappear — and cap against the
    // viewport so short screens and phones behave too (§6 mobile pass).
    <div
      className={`pointer-events-auto absolute left-4 top-48 z-40 flex max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-sm border border-white/10 bg-black/40 backdrop-blur-md transition-[width,padding] duration-200 ${
        isCollapsed === true
          ? "w-10 p-2"
          : isCollapsed === false
            ? "max-h-[calc(100vh-19rem)] w-64 p-3"
            : "max-h-[calc(100vh-19rem)] w-64 p-3 max-md:max-h-none max-md:w-10 max-md:p-2"
      }`}
    >
      <div
        className={`flex shrink-0 items-center ${
          isCollapsed === true
            ? "justify-center"
            : isCollapsed === false
              ? "mb-2 justify-between"
              : "mb-2 justify-between max-md:mb-0 max-md:justify-center"
        }`}
      >
        <h3
          className={`font-mono text-[9px] uppercase tracking-[0.25em] text-white/70 ${
            isCollapsed === true
              ? "hidden"
              : isCollapsed === null
                ? "max-md:hidden"
                : ""
          }`}
        >
          Drop object
        </h3>
        <button
          type="button"
          onClick={toggleCollapsed}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-white/10 text-white/50 transition-colors hover:border-white/30 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300"
          aria-controls="test-object-panel-content"
          aria-expanded={isCollapsed === null ? undefined : !isCollapsed}
          aria-label={
            isCollapsed === null
              ? "Toggle side menu"
              : isCollapsed
                ? "Expand side menu"
                : "Collapse side menu"
          }
          title={
            isCollapsed === null
              ? "Toggle side menu"
              : isCollapsed
                ? "Expand side menu"
                : "Collapse side menu"
          }
        >
          {isCollapsed === null ? (
            <>
              <ChevronLeft className="h-3.5 w-3.5 max-md:hidden" />
              <ChevronRight className="hidden h-3.5 w-3.5 max-md:block" />
            </>
          ) : isCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      <div
        id="test-object-panel-content"
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${
          isCollapsed === true
            ? "hidden"
            : isCollapsed === null
              ? "max-md:hidden"
              : ""
        }`}
      >
        {editing && (
          <fieldset disabled={status === "integrating"}>
            <legend className="sr-only">Object setup</legend>
            <p className="mb-3 text-xs text-white/60">
              Choose a behaviour, set the distance, then launch.
            </p>
            <div
              className="mb-3 grid grid-cols-3 gap-1"
              role="group"
              aria-label="Object behaviour"
            >
              {(
                [
                  ["radialFall", "Drop straight in"],
                  ["circular", "Orbit"],
                  ["apsides", "Custom"],
                ] as const
              ).map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  aria-pressed={
                    preset === key ||
                    (key === "circular" && preset === "eccentric")
                  }
                  onClick={() => onPresetChange(key)}
                  disabled={status === "integrating"}
                  className="min-h-11 rounded border border-white/15 px-2 text-xs text-white/70 hover:bg-white/10 aria-pressed:border-cyan-300/70 aria-pressed:bg-cyan-300/15 aria-pressed:text-cyan-100 disabled:opacity-40"
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mb-3 text-xs text-white/60">
              {PRESETS.find((p) => p.key === preset)?.hint}
            </p>
            {(preset === "circular" || preset === "apsides") &&
              onParamsChange && (
                <button
                  type="button"
                  className="mb-3 w-full rounded border border-cyan-300/30 py-2 text-xs text-cyan-100"
                  onClick={() =>
                    onParamsChange({
                      zoom: Math.max(
                        12,
                        (preset === "apsides" ? object.apsides.apoapsis : r0) *
                          2,
                      ),
                    })
                  }
                >
                  Fit orbit in view
                </button>
              )}
            {preset !== "isco" && preset !== "apsides" && (
              <>
                <label className="mb-1 flex justify-between font-mono text-[8px] uppercase tracking-[0.15em] text-white/40">
                  <span>Distance</span>
                  <span className="text-white/70">{r0.toFixed(1)} M</span>
                </label>
                <input
                  type="range"
                  min={7}
                  max={300}
                  step={0.5}
                  value={r0}
                  onChange={(e) => setR0(Number(e.target.value))}
                  className="mb-3 w-full accent-cyan-300"
                  aria-label="Distance from black hole in units of M"
                />
              </>
            )}

            {preset !== "isco" && preset !== "apsides" && (
              <div className="mb-3 flex justify-between text-xs text-white/40">
                <span>Near</span>
                <span>Far</span>
              </div>
            )}
            {preset === "apsides" && (
              <p className="mb-3 text-xs text-cyan-100/80">
                Drag apoapsis / periapsis to resize. Drag the major-axis line to
                turn the orbit. Drag A or B to tilt it in 3D, then launch.
              </p>
            )}
            <details className="mb-3 rounded border border-white/10 p-2">
              <summary className="cursor-pointer text-xs text-white/70">
                Advanced settings
              </summary>
              <label className="mt-3 block text-xs text-white/60">
                Orbit preset
                <select
                  aria-label="Drop trajectory preset"
                  value={preset}
                  onChange={(e) =>
                    onPresetChange(e.target.value as DropPresetName)
                  }
                  className="my-2 w-full rounded bg-black p-2 text-xs text-white"
                >
                  {PRESETS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              {preset === "apsides" && <ApsidesSection object={object} />}
            </details>
          </fieldset>
        )}
        <div className="sticky bottom-0 z-10 mb-3 flex gap-2 border-t border-white/10 bg-black/95 py-3">
          {editing ? (
            <button
              type="button"
              onClick={launch}
              disabled={status === "integrating"}
              className="min-h-11 flex-1 rounded bg-cyan-200 px-3 text-sm font-semibold text-black hover:bg-cyan-100 disabled:opacity-40"
            >
              {status === "integrating" ? "Preparing…" : "Launch object ↵"}
            </button>
          ) : (
            <>
              {worldline && (
                <button
                  type="button"
                  onClick={retry}
                  disabled={!lastLaunch.current || status === "integrating"}
                  className="min-h-11 rounded bg-cyan-200 px-3 text-xs text-black disabled:opacity-40"
                >
                  Retry · R
                </button>
              )}
              <button
                type="button"
                disabled={status === "integrating"}
                onClick={() => {
                  object.setView("third");
                  object.setPaused(true);
                  onEditingChange(true);
                }}
                className="min-h-11 flex-1 rounded border border-white/20 px-2 text-xs text-white disabled:opacity-40"
              >
                {status === "integrating"
                  ? "Preparing…"
                  : worldline
                    ? "Edit setup"
                    : "Place object"}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              object.reset();
              onEditingChange(true);
            }}
            disabled={!worldline}
            className="rounded-sm border border-white/10 px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-white/50 transition-colors hover:text-white/90 disabled:opacity-30"
          >
            Clear
          </button>
        </div>

        <p className="mb-3 text-[10px] text-white/40">
          {editing ? "Enter to launch · Esc to cancel" : "Space to pause"}
        </p>
        {error && (
          <p className="mb-2 font-mono text-[8px] text-red-400/80">{error}</p>
        )}

        {readout && (
          <details className="mb-3">
            <summary className="cursor-pointer py-2 text-xs text-white/70">
              Measurements
            </summary>
            <dl className="space-y-1 border-t border-white/10 pt-2 font-mono text-[9px]">
              <Row
                label="r"
                value={`${readout.rOverRs.toFixed(3)} r_s · ${formatLength(readout.rKm)}`}
              />
              {/* Two clocks, always both: their disagreement is the physics (§1.6). */}
              <Row
                label="τ object"
                value={formatDuration(readout.tauSeconds)}
              />
              <Row
                label="t observer"
                value={
                  Number.isFinite(readout.tFarSeconds)
                    ? formatDuration(readout.tFarSeconds)
                    : "∞ (never seen)"
                }
              />
              <Row
                label="v local"
                value={`${(readout.localVelocity * 100).toFixed(2)}% c`}
              />
              <Row
                label="tidal / m"
                value={`${readout.tidalG.toExponential(2)} g`}
              />
              <Row label="redshift" value={readout.redshift.toFixed(4)} />
              {worldline && (
                <Row
                  label="E/L drift"
                  value={`${worldline.audit.energyDrift.toExponential(1)} / ${worldline.audit.angularMomentumDrift.toExponential(1)}`}
                />
              )}
            </dl>
          </details>
        )}

        {worldline && <SpeedControl object={object} />}

        {worldline && <ViewToggle object={object} />}
        <details className="mt-3 border-t border-white/10 pt-2">
          <summary className="mb-2 cursor-pointer text-xs text-white/70">
            Black hole & appearance
          </summary>
          <select
            value={selection}
            onChange={(e) => handleSelection(e.target.value)}
            className="mb-1 w-full rounded-sm border border-white/10 bg-black/60 px-2 py-1 font-mono text-[10px] text-white/80"
            aria-label="Black hole"
          >
            <optgroup label="Generic">
              {MASS_PRESETS.map((p) => (
                <option key={p.id} value={`preset:${p.id}`}>
                  {p.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Real objects">
              {REAL_BLACK_HOLES.map((o) => (
                <option key={o.id} value={`real:${o.id}`}>
                  {o.name}
                </option>
              ))}
            </optgroup>
          </select>

          {realObject ? (
            <RealObjectCard
              object={realObject}
              locked={realObjectLocked}
              onRestore={onRestoreRealObject}
            />
          ) : (
            <p className="mb-1 font-mono text-[8px] text-white/35">
              {massPreset.hint}
            </p>
          )}

          <dl className="mb-3 space-y-0.5 font-mono text-[8px]">
            <Row
              label="r_s"
              value={formatLength(
                schwarzschildRadiusKm(massPreset.solarMasses),
              )}
            />
            <Row
              label="ISCO period"
              value={formatDuration(iscoPeriodSeconds(massPreset.solarMasses))}
            />
            <Row
              label="disk peak T"
              value={`${peakDiskTemperatureK(massPreset.solarMasses).toExponential(1)} K`}
            />
          </dl>

          {/*
        Honesty rule (§6, "honesty over prettiness"). The row above states the
        physical peak temperature; the shader now renders that same number by
        default, so the colour on screen is the real visible-band colour of a
        disk that hot — which is a nearly flat pale blue, because everything
        above ~20,000 K sits in the same Rayleigh-Jeans tail. If the user drags
        the temperature away from the physical value to get the familiar
        orange gradient back, that is false colour and the UI has to say so
        rather than letting the readout above imply otherwise.
      */}
          {params && (
            <p
              className={`mb-3 font-mono text-[8px] leading-relaxed ${
                trueColour ? "text-white/35" : "text-amber-300/70"
              }`}
            >
              {trueColour
                ? "Physical colour: this is how a blackbody at the temperature above actually looks — almost featureless blue-white, with the visible structure coming from beaming rather than temperature."
                : `False colour: rendering at ${params.diskTemp.toExponential(1)} K, not the ${peakDiskTemperatureK(
                    massPreset.solarMasses,
                  ).toExponential(
                    1,
                  )} K above. Hue is exaggerated to show the Doppler shift.`}
            </p>
          )}

          {params && onParamsChange && (
            <PowerControl params={params} onChange={onParamsChange} />
          )}
        </details>
        <p className="mt-2 font-mono text-[7px] leading-relaxed text-white/30">
          Geometric units (G = c = M = 1). Physical scales — km, seconds, kelvin
          — arrive with the mass presets.
        </p>
      </div>
    </div>
  );
}

/**
 * The apsides controls (spec §6.3).
 *
 * Sliders as well as drag handles, for two reasons: a handle that is edge-on to
 * the camera cannot be grabbed at all, and a drag is not keyboard-reachable.
 * Both write the same state the overlay does.
 *
 * The verdict line is the honest part. It comes from the Rust solver rather
 * than from a rule of thumb, and it says *why* — a periapsis inside the
 * separatrix is a capture, and the separatrix is not the ISCO.
 */
function ApsidesSection({ object }: { object: UseTestObject }) {
  const { apsides, setApsides, apsidesSolution, measuredApsides } = object;
  const captures = apsidesSolution?.plunges ?? false;
  const actualInclination = standardOrbitElements(apsides).inclination;

  return (
    <>
      <label className="mb-1 flex justify-between font-mono text-[8px] uppercase tracking-[0.15em] text-white/40">
        <span>Closest approach</span>
        <span className="text-white/70">{apsides.periapsis.toFixed(1)} M</span>
      </label>
      <input
        type="range"
        min={0.2}
        max={400}
        step={0.1}
        value={apsides.periapsis}
        onChange={(e) =>
          setApsides({ ...apsides, periapsis: Number(e.target.value) })
        }
        className={`mb-2 w-full ${captures ? "accent-red-400" : "accent-cyan-300"}`}
        aria-label="Periapsis in units of M"
      />
      <label className="mb-1 flex justify-between font-mono text-[8px] uppercase tracking-[0.15em] text-white/40">
        <span>Farthest point</span>
        <span className="text-white/70">{apsides.apoapsis.toFixed(1)} M</span>
      </label>
      <input
        type="range"
        min={0.2}
        max={400}
        step={0.1}
        value={apsides.apoapsis}
        onChange={(e) =>
          setApsides({ ...apsides, apoapsis: Number(e.target.value) })
        }
        className={`mb-2 w-full ${captures ? "accent-red-400" : "accent-cyan-300"}`}
        aria-label="Apoapsis in units of M"
      />

      <AngleSlider
        label="Orbit direction"
        value={apsides.argument}
        max={360}
        onChange={(argument) => setApsides({ ...apsides, argument })}
      />
      <AngleSlider
        label="Tilt"
        value={apsides.inclination}
        max={85}
        onChange={(inclination) => setApsides({ ...apsides, inclination })}
      />
      <AngleSlider
        label="Ascending node"
        value={apsides.ascendingNode}
        max={360}
        onChange={(ascendingNode) => setApsides({ ...apsides, ascendingNode })}
      />
      <AngleSlider
        label="Apsidal-axis tilt"
        value={apsides.apsidalRotation}
        min={-90}
        max={90}
        onChange={(apsidalRotation) =>
          setApsides({ ...apsides, apsidalRotation })
        }
      />

      <p
        className={`mb-3 font-mono text-[8px] leading-relaxed ${
          captures ? "text-red-300/80" : "text-white/35"
        }`}
      >
        {apsidesSolution === null ? (
          "…"
        ) : captures ? (
          <>
            Capture. No bound orbit reaches {apsides.periapsis.toFixed(1)} M
            from {apsides.apoapsis.toFixed(1)} M — the separatrix is at{" "}
            {apsidesSolution.separatrix.toFixed(2)} M. Dropping here plunges,
            which is the physics, not a limit of the control.
          </>
        ) : (
          <>
            {actualInclination > 1e-6 ? (
              <>
                Bound inclined orbit. The Kerr solver validated both radial
                turning points; the equatorial reference separatrix is{" "}
                {apsidesSolution.separatrix.toFixed(2)} M.
              </>
            ) : (
              <>
                Bound orbit. Separatrix for this apoapsis:{" "}
                {apsidesSolution.separatrix.toFixed(2)} M — a periapsis inside
                the ISCO can still be stable, so that is the real floor, not the
                ISCO.
              </>
            )}
          </>
        )}
      </p>

      {measuredApsides && (
        <dl className="mb-3 space-y-0.5 font-mono text-[8px]">
          {/* Measured, not requested: what the integration actually did. */}
          <Row
            label="reached"
            value={`${measuredApsides.min.toFixed(2)} – ${measuredApsides.max.toFixed(2)} M`}
          />
        </dl>
      )}
    </>
  );
}

function AngleSlider({
  label,
  value,
  min = 0,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  onChange: (radians: number) => void;
}) {
  const degrees = (value * 180) / Math.PI;
  return (
    <>
      <label className="mb-1 flex justify-between font-mono text-[8px] uppercase tracking-[0.15em] text-white/40">
        <span>{label}</span>
        <span className="text-white/70">{degrees.toFixed(0)}°</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={degrees}
        onChange={(e) => onChange((Number(e.target.value) * Math.PI) / 180)}
        className="mb-2 w-full accent-cyan-300"
        aria-label={`${label} in degrees`}
      />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-white/40">{label}</dt>
      <dd className="text-white/85">{value}</dd>
    </div>
  );
}
