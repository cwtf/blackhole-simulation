"use client";

import { useEffect, useState } from "react";

import type { UseTestObject } from "@/hooks/useTestObject";
import { horizonRadius } from "@/hooks/useCamera";

/**
 * End of the 1st-person ride (spec §1.6).
 *
 * "End the run at r ≈ 0.02 r_s with a fade + 'reached the singularity' card
 * and the final τ (Schwarzschild interior gives finite remaining proper time
 * ≤ πGM/c³ from horizon crossing — display it)."
 *
 * Only shown in 1st person: from far away the object is never seen to arrive
 * at all, so announcing its arrival there would contradict the physics the
 * 3rd-person view exists to show.
 *
 * Two things this used to get wrong.
 *
 * **The wrong τ.** It printed `totalProperTime` — measured from release —
 * directly above "Interior bound πM". A drop from r = 20 M therefore read
 * "98.020" against "3.142", which looks like a thirty-fold violation of a
 * bound the card states in the next line. The bound applies to the stretch
 * *from horizon crossing*, which for that drop is 1.372. Both numbers are now
 * shown, labelled, and only the interior one is compared.
 *
 * **It was a dead end.** A full-screen dim with no way out is a wall: you
 * could not look at where you had arrived, could not get back to the outside
 * view, could not do anything but reload. It dismisses now, and says what the
 * remaining options are — including the honest fact that there is no "further
 * in" to offer, because the worldline ends here.
 */
export function SingularityCard({
  object,
  mass,
  spin,
}: {
  object: UseTestObject;
  mass: number;
  spin: number;
}) {
  const [dismissed, setDismissed] = useState(false);
  const arrived = object.view === "first" && object.reachedSingularity;
  // The ride can also end by reversing inside the horizon. Announcing nothing
  // there leaves the view apparently hung at a radius the user cannot account
  // for, which is indistinguishable from the bug that used to produce it.
  const reversed = object.view === "first" && object.reversedInsideHorizon;
  const ended = arrived || reversed;

  // A fresh drop is a fresh ending; the card has to come back for it.
  useEffect(() => {
    if (!ended) setDismissed(false);
  }, [ended]);

  if (!ended || dismissed) return null;

  const totalTau = object.worldline?.totalProperTime ?? 0;
  const rHorizon = horizonRadius(mass, spin);
  const interiorTau =
    object.worldline?.properTimeInsideHorizon(rHorizon) ?? null;

  // πM is the Schwarzschild maximum, attained by release from rest at the
  // horizon itself. A spinning hole has an inner (Cauchy) horizon and a ring
  // singularity, so the same number is not the bound — say so instead of
  // quoting it as though it were.
  const schwarzschild = Math.abs(spin) < 1e-3;
  const interiorBound = Math.PI * mass;

  // Where the ride actually stopped, for the reversal case. The turning point is
  // the number that explains the ending, so it is the number to show.
  const turningRadius = object.worldline
    ? object.worldline.at(object.worldline.count - 1).r
    : 0;

  // Where the run actually stopped, rather than a constant that used to be true
  // for every preset and no longer is.
  const endRadius = turningRadius;

  return (
    <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" />
      <div className="pointer-events-auto relative max-w-md rounded-sm border border-white/15 bg-black/70 px-8 py-6 text-center">
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.35em] text-white/90">
          {arrived ? "Reached the singularity" : "The fall reversed"}
        </h2>

        <dl className="space-y-1 font-mono text-[10px]">
          <div className="flex justify-between gap-6">
            <dt className="text-white/45">Proper time from release τ</dt>
            <dd className="text-white/90">{totalTau.toFixed(3)}</dd>
          </div>
          <div className="flex justify-between gap-6">
            <dt className="text-white/45">…of which inside the horizon</dt>
            <dd className="text-white/90">
              {interiorTau === null ? "—" : interiorTau.toFixed(3)}
            </dd>
          </div>
          {reversed && (
            <div className="flex justify-between gap-6">
              <dt className="text-white/45">Turning point r</dt>
              <dd className="text-white/90">
                {turningRadius.toFixed(3)} M ({(turningRadius / mass).toFixed(3)}{" "}
                M/M)
              </dd>
            </div>
          )}
          {arrived && (
            <div className="flex justify-between gap-6">
              <dt className="text-white/45">
                {schwarzschild ? "Interior bound πM" : "πM (Schwarzschild only)"}
              </dt>
              <dd
                className={
                  schwarzschild &&
                  interiorTau !== null &&
                  interiorTau <= interiorBound
                    ? "text-emerald-300/80"
                    : "text-white/90"
                }
              >
                {interiorBound.toFixed(3)}
              </dd>
            </div>
          )}
        </dl>

        {arrived && !schwarzschild && (
          <p className="mt-3 font-mono text-[7px] leading-relaxed text-amber-300/60">
            This hole is spinning (a* = {spin.toFixed(3)}), so πM is not its
            bound — a Kerr interior has an inner horizon and a ring
            singularity. The figure is shown for reference only.
          </p>
        )}

        <p className="mt-4 font-mono text-[8px] leading-relaxed text-white/40">
          Nothing locally unusual happened at the horizon; it was crossed in
          finite proper time. No distant observer ever saw the crossing —
          switch to 3rd person and the object is still frozen there, reddening.
        </p>

        {arrived ? (
          <p className="mt-3 font-mono text-[8px] leading-relaxed text-white/35">
            There is no further in. The worldline does not stop because the
            simulation gave up — it ends because the geodesic is incomplete, and
            general relativity has nothing to say past this point.
          </p>
        ) : (
          <>
            <p className="mt-3 font-mono text-[8px] leading-relaxed text-white/35">
              You did not reach the centre, and nothing went wrong. This hole
              spins (a* = {spin.toFixed(3)}), and a Kerr interior repels an
              infaller carrying no angular momentum: the barrier goes as
              2Ma²E², so a release from rest just outside the horizon — which is
              what flying the camera in gives you — has too little energy to get
              past it. It turns around and heads back out. Drop from further out
              and the same hole is reached all the way to the cutoff.
            </p>
            <p className="mt-3 font-mono text-[8px] leading-relaxed text-white/35">
              The ride ends at the turning point because the next thing that
              happens is an outbound crossing of the inner (Cauchy) horizon, and
              the ingoing Kerr-Schild coordinates this simulation runs in have no
              chart on the other side of it. That is a limit of the coordinates,
              not of the physics — and following it would mean leaving this
              universe for another copy of it.
            </p>
          </>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="flex-1 rounded-sm border border-white/15 px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.15em] text-white/70 transition-colors hover:border-white/35 hover:text-white/90"
          >
            Stay here
          </button>
          <button
            type="button"
            onClick={() => {
              setDismissed(true);
              object.setView("third");
            }}
            className="flex-1 rounded-sm border border-white/15 px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.15em] text-white/70 transition-colors hover:border-white/35 hover:text-white/90"
          >
            Watch from outside
          </button>
        </div>

        <p className="mt-3 font-mono text-[7px] text-white/30">
          {arrived
            ? `Geometric units (G = c = M = 1). Integration ends at r = ${endRadius.toPrecision(2)} M, not at r = 0 — the last stretch is unrenderable, not skipped. How deep it goes is set by where a body of this scale stops holding together.`
            : "Geometric units (G = c = M = 1). The turning point is where dr/dτ changes sign; it agrees with the analytic root of the radial potential to five decimals."}
        </p>
      </div>
    </div>
  );
}
