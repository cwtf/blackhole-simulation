/**
 * Tidal deformation of the rider's body (spec §1.6).
 *
 * The suit is the one thing in the 1st-person frame that is neither lensed nor
 * shifted, which is exactly what makes it the right place to show the one
 * effect that acts on the observer rather than on the light: the tide.
 *
 * **Why this is not a fudge.** How far living tissue stretches under a given
 * load is a materials question, and guessing at it would be the "ad-hoc
 * per-effect shader" §5 warns about. But past the point where the tide exceeds
 * what the body can hold together, there is no materials question left: the
 * pieces stop interacting and each one follows its own geodesic. The
 * deformation is then the geodesic-deviation solution, in closed form.
 *
 * For marginally bound radial infall in Schwarzschild, `dr/dtau = -sqrt(2M/r)`.
 * Two neighbouring dust particles on the same radial line satisfy
 *
 * ```text
 *   d(dr)/dtau = dr * d/dr(-sqrt(2M/r))  =>  dr proportional to r^(-1/2)
 * ```
 *
 * and the proper radial separation equals `dr` on a slice of constant rain
 * time, because the spatial metric of the infalling (Painleve-Gullstrand) frame
 * is flat. Transversely, `theta` is constant along a radial geodesic, so the
 * proper separation `r * dtheta` goes as `r`. Hence
 *
 * ```text
 *   radial:      S_r = sqrt(r_fail / r)      (stretch)
 *   transverse:  S_t = r / r_fail            (squeeze, both axes)
 * ```
 *
 * Differentiating twice recovers the tidal tensor exactly — `+2M/r^3` along the
 * radius and `-M/r^3` on each transverse axis, the 2 : -1 : -1 signature — which
 * is what `geodesic_deviation_matches_the_closed_form` in the tests checks
 * rather than assumes. Volume goes as `r^(3/2)`, the correct convergence of the
 * infalling congruence; it is not preserved, and should not be.
 *
 * Two honest caveats. The law is exact for marginally bound radial infall in
 * Schwarzschild and is an approximation for a spinning hole or a drop from a
 * finite radius — the deep-interior regime where it matters most is also where
 * it is closest, since any infall approaches the marginally bound one as
 * `r -> 0`. And `BODY_FAILURE_G` is a biological convention, not a result: it
 * sets *when* the deformation starts, and nothing else.
 */

import { tidalAccelerationG } from "@/configs/mass-presets";

/** Head-to-toe extent the tidal load is quoted across, in metres. */
export const BODY_HEIGHT_M = 1.8;

/**
 * Tidal load across the body at which it stops holding itself together, in
 * Earth gravities.
 *
 * A convention, and the only free parameter here. 1000 g across 1.8 m is far
 * past any survivable load and comfortably past the tensile failure of bone
 * and connective tissue, so it marks the point where treating the body as dust
 * becomes the *more* accurate model rather than the less.
 */
export const BODY_FAILURE_G = 1000;

/**
 * Presentational clamps.
 *
 * `S_r` diverges and `S_t` vanishes as `r -> 0`, so without a bound the suit
 * becomes an infinitely long, infinitely thin needle and then a NaN. These
 * cap what is drawn; they do not enter any number the readouts report. The
 * transverse floor also bounds the ray-march cost, because a non-uniformly
 * scaled distance field has to be stepped at the smallest scale factor.
 */
export const MAX_RADIAL_STRETCH = 6;
export const MIN_TRANSVERSE_SQUEEZE = 0.18;

export interface SuitStrain {
  /**
   * Scale along both transverse axes of the tetrad — `e1` (right, azimuthal)
   * and `e2` (up, polar). At most 1: the body is squeezed.
   */
  transverse: number;
  /**
   * Scale along `e3`, which `orientFrame` defines as the inward radial
   * direction. At least 1: the body is stretched.
   *
   * Note what this means for the picture. The frame looks *along* the radius,
   * and the suit's spine runs down `e2`, so the rider falls face-first and the
   * stretch runs away from the eye rather than head to toe. The popular image
   * of a body drawn out lengthwise is the feet-first case; this frame is not
   * that one, and drawing it lengthwise here would contradict `orientFrame`.
   */
  radial: number;
  /** True once the body has passed `BODY_FAILURE_G` and is deforming. */
  failing: boolean;
}

export const NO_STRAIN: SuitStrain = {
  transverse: 1,
  radial: 1,
  failing: false,
};

/**
 * Radius, in units of GM/c^2, at which the tidal load across `separationM`
 * reaches `thresholdG`.
 *
 * The inverse of `tidalAccelerationG`, solved directly rather than searched:
 * the load goes as `r^-3`, so one cube root does it.
 */
export function tidalFailureRadius(
  solarMasses: number,
  thresholdG: number = BODY_FAILURE_G,
  separationM: number = BODY_HEIGHT_M,
): number {
  if (!(thresholdG > 0) || !(solarMasses > 0)) return 0;
  // tidalAccelerationG(r) = k / r^3  =>  r = (k / threshold)^(1/3), and k is
  // recovered by evaluating the forward function once at r = 1. Deriving it
  // this way keeps the constants in one place: if the forward expression ever
  // changes, this follows it instead of drifting from it.
  const k = tidalAccelerationG(1, solarMasses, separationM);
  return Math.cbrt(k / thresholdG);
}

/**
 * Deformation of the rider's body at radius `rGeometric` (units of GM/c^2).
 *
 * Returns the identity outside the failure radius: a body that is holding
 * itself together has no visible strain, and pretending otherwise would put a
 * deformation on screen at radii where a person would feel nothing at all.
 */
export function suitStrain(
  rGeometric: number,
  solarMasses: number,
  thresholdG: number = BODY_FAILURE_G,
  separationM: number = BODY_HEIGHT_M,
): SuitStrain {
  const rFail = tidalFailureRadius(solarMasses, thresholdG, separationM);
  if (!(rGeometric > 0) || !(rFail > 0) || rGeometric >= rFail) {
    return NO_STRAIN;
  }

  const ratio = rGeometric / rFail; // < 1
  return {
    transverse: Math.max(MIN_TRANSVERSE_SQUEEZE, ratio),
    radial: Math.min(MAX_RADIAL_STRETCH, Math.sqrt(1 / ratio)),
    failing: true,
  };
}
