"use client";

import React, { useRef } from "react";
import { FastForward, Pause, Play, Rewind } from "lucide-react";

import type { UseTestObject } from "@/hooks/useTestObject";
import { formatSpeed } from "@/physics/playback";

/** First-person transport for worldlines that actually cross the event horizon. */
export function TrajectoryPlayback({ object }: { object: UseTestObject }) {
  const resumeAfterScrub = useRef(false);
  const {
    worldline,
    properTime,
    paused,
    setPaused,
    speed,
    transportRate,
    stepTransport,
    playForward,
    trajectoryProgress,
    seekTrajectory,
    crossesEventHorizon,
    eventHorizonProgress,
    horizonSlowdown,
  } = object;

  if (
    object.view !== "first" ||
    !worldline ||
    !crossesEventHorizon ||
    worldline.totalProperTime <= 0
  ) {
    return null;
  }

  const transportLabel = paused
    ? "Paused"
    : transportRate < 0
      ? `Rewind ${Math.abs(transportRate)}x`
      : `Forward ${transportRate}x`;
  const effectiveSpeed = speed * Math.abs(transportRate) * horizonSlowdown;
  const trajectoryPhase =
    eventHorizonProgress !== null && trajectoryProgress >= eventHorizonProgress
      ? "Inside horizon"
      : "Horizon approach";

  const finishScrub = () => {
    if (resumeAfterScrub.current) setPaused(false);
    resumeAfterScrub.current = false;
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[4.5rem] z-40 px-3 md:bottom-6">
      <div className="pointer-events-auto mx-auto w-full max-w-xl rounded-sm border border-white/15 bg-black/65 px-3 py-2 shadow-2xl backdrop-blur-md">
        <div className="mb-1 flex items-center justify-between font-mono text-[7px] uppercase tracking-[0.16em] text-white/45">
          <span>Release</span>
          <span className="text-white/70">
            {trajectoryPhase} · {Math.round(trajectoryProgress * 100)}% · τ{" "}
            {properTime.toFixed(2)} / {worldline.totalProperTime.toFixed(2)}
          </span>
          <span>End</span>
        </div>

        <div className="relative">
          {eventHorizonProgress !== null && (
            <span
              className="pointer-events-none absolute top-1/2 z-10 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-amber-300/90"
              style={{ left: `${eventHorizonProgress * 100}%` }}
              title="Event horizon"
              aria-hidden="true"
            />
          )}
          <input
            type="range"
            min={0}
            max={1}
            step={0.0005}
            value={trajectoryProgress}
            onChange={(event) => seekTrajectory(Number(event.target.value))}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              resumeAfterScrub.current = !paused;
              setPaused(true);
            }}
            onPointerUp={finishScrub}
            onPointerCancel={finishScrub}
            className="block w-full accent-cyan-300"
            aria-label="Trajectory progress"
          />
        </div>

        <div className="mt-1 flex items-center justify-center gap-2">
          <TransportButton
            label="Rewind"
            title="Rewind; press repeatedly for 2x, 4x, 8x, and 16x"
            onClick={() => stepTransport(-1)}
          >
            <Rewind className="h-4 w-4" fill="currentColor" />
          </TransportButton>

          <TransportButton
            label={paused ? "Play" : "Pause"}
            title={paused ? "Play forward" : "Pause"}
            active={!paused}
            onClick={() => (paused ? playForward() : setPaused(true))}
          >
            {paused ? (
              <Play className="h-4 w-4" fill="currentColor" />
            ) : (
              <Pause className="h-4 w-4" fill="currentColor" />
            )}
          </TransportButton>

          <TransportButton
            label="Fast forward"
            title="Fast forward; press repeatedly for 2x, 4x, 8x, and 16x"
            onClick={() => stepTransport(1)}
          >
            <FastForward className="h-4 w-4" fill="currentColor" />
          </TransportButton>

          <div className="ml-2 min-w-28 border-l border-white/10 pl-3 font-mono">
            <div className="text-[8px] uppercase tracking-[0.14em] text-white/75">
              {transportLabel}
            </div>
            <div
              className={`text-[7px] ${horizonSlowdown < 0.999 ? "text-amber-300/80" : "text-white/35"}`}
            >
              {formatSpeed(effectiveSpeed, paused)}
              {horizonSlowdown < 0.999 ? " · horizon slow" : " playback"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TransportButton({
  label,
  title,
  active = false,
  onClick,
  children,
}: {
  label: string;
  title: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 w-9 items-center justify-center rounded-sm border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300 ${
        active
          ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100"
          : "border-white/10 text-white/60 hover:border-white/30 hover:text-white"
      }`}
      aria-label={label}
      title={title}
    >
      {children}
    </button>
  );
}
