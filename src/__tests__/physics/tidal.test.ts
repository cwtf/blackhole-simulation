import { describe, it, expect } from "vitest";

import { tidalAccelerationG } from "@/configs/mass-presets";
import {
  BODY_FAILURE_G,
  BODY_HEIGHT_M,
  MAX_RADIAL_STRETCH,
  MIN_TRANSVERSE_SQUEEZE,
  NO_STRAIN,
  suitStrain,
  tidalFailureRadius,
} from "@/physics/tidal";

/**
 * Spec §1.6: the tide, applied to the rider rather than to the light.
 *
 * The point of these tests is that the deformation is a *derived* quantity, not
 * a chosen curve. If the closed form in `physics/tidal.ts` is right, it must
 * satisfy the geodesic deviation equation — so that is what gets checked, by
 * differentiating it numerically along an actual infall rather than by
 * restating the algebra.
 */

const SGR_A = 4.154e6;
const STELLAR = 10;
const M87 = 6.5e9;

describe("tidal failure radius", () => {
  it("inverts the tidal load exactly", () => {
    for (const sun of [STELLAR, SGR_A, M87]) {
      for (const threshold of [1, 10, 1000, 1e6]) {
        const r = tidalFailureRadius(sun, threshold);
        expect(tidalAccelerationG(r, sun, BODY_HEIGHT_M)).toBeCloseTo(
          threshold,
          6,
        );
      }
    }
  });

  it("scales as M^(-2/3) relative to the horizon", () => {
    // r_fail goes as M^(1/3), r_s goes as M, so the ratio goes as M^(-2/3).
    // Two decades of mass must move the ratio by 10^(-4/3).
    const a = tidalFailureRadius(1e4) / 2;
    const b = tidalFailureRadius(1e6) / 2;
    expect(Math.log10(a / b)).toBeCloseTo((4 / 3) * 1, 6);
  });

  it("puts the failure point outside a stellar horizon and inside a supermassive one", () => {
    // The whole answer to "how far in does it happen", as an assertion. r_s = 2M
    // in geometric units.
    expect(tidalFailureRadius(STELLAR) / 2).toBeGreaterThan(1);
    expect(tidalFailureRadius(SGR_A) / 2).toBeLessThan(1);
    expect(tidalFailureRadius(M87) / 2).toBeLessThan(
      tidalFailureRadius(SGR_A) / 2,
    );
  });

  it("is inert for nonsense input rather than returning NaN", () => {
    expect(tidalFailureRadius(0)).toBe(0);
    expect(tidalFailureRadius(SGR_A, 0)).toBe(0);
    expect(tidalFailureRadius(-1)).toBe(0);
  });
});

describe("suit strain", () => {
  it("is the identity while the body still holds together", () => {
    const rFail = tidalFailureRadius(SGR_A);
    expect(suitStrain(rFail * 4, SGR_A)).toEqual(NO_STRAIN);
    expect(suitStrain(rFail * 1.0001, SGR_A).failing).toBe(false);
    // At the horizon of a supermassive hole a person is entirely intact, which
    // is the claim the 1st-person view exists to make.
    expect(suitStrain(2, SGR_A).failing).toBe(false);
    expect(suitStrain(2, SGR_A).radial).toBe(1);
  });

  it("is already failing at a stellar-mass horizon", () => {
    // The counterpart: around a 10 M-sun hole the rider is long gone before the
    // crossing, so the suit must be deformed at r_s and beyond.
    expect(suitStrain(2, STELLAR).failing).toBe(true);
    expect(suitStrain(2 * 20, STELLAR).failing).toBe(true);
  });

  it("is continuous at the failure radius", () => {
    const rFail = tidalFailureRadius(SGR_A);
    const just = suitStrain(rFail * 0.999999, SGR_A);
    expect(just.transverse).toBeCloseTo(1, 5);
    expect(just.radial).toBeCloseTo(1, 5);
  });

  it("stretches radially and squeezes transversely, never the reverse", () => {
    const rFail = tidalFailureRadius(SGR_A);
    for (const f of [0.9, 0.7, 0.5, 0.3, 0.2]) {
      const s = suitStrain(rFail * f, SGR_A);
      expect(s.radial).toBeGreaterThan(1);
      expect(s.transverse).toBeLessThan(1);
      expect(s.failing).toBe(true);
    }
  });

  it("honours the presentational clamps", () => {
    const rFail = tidalFailureRadius(SGR_A);
    const deep = suitStrain(rFail * 1e-6, SGR_A);
    expect(deep.radial).toBe(MAX_RADIAL_STRETCH);
    expect(deep.transverse).toBe(MIN_TRANSVERSE_SQUEEZE);
    // Never zero or negative: suit_trace divides by both.
    expect(deep.transverse).toBeGreaterThan(0);
    expect(suitStrain(0, SGR_A)).toEqual(NO_STRAIN);
    expect(suitStrain(-1, SGR_A)).toEqual(NO_STRAIN);
  });

  /**
   * The load-bearing test.
   *
   * Geodesic deviation for a radial infaller in Schwarzschild:
   *
   *   d^2(xi_radial)/dtau^2     = +2M/r^3 * xi_radial
   *   d^2(xi_transverse)/dtau^2 = -M/r^3  * xi_transverse
   *
   * The 2 : -1 : -1 signature. Marching the closed-form scale factors along an
   * actual marginally bound trajectory and second-differencing them has to
   * reproduce both, or the deformation on screen is not geodesic deviation and
   * the comment claiming it is would be wrong.
   *
   * Geometric units with M = 1, so r is in units of GM/c^2 exactly as
   * `suitStrain` takes it, and dr/dtau = -sqrt(2/r).
   */
  it("satisfies the geodesic deviation equation it claims to solve", () => {
    const sun = SGR_A;
    const rFail = tidalFailureRadius(sun);
    // r(tau) for release from rest at infinity, in units where M = 1.
    const rOfTau = (r0: number, tau: number) =>
      Math.pow(Math.pow(r0, 1.5) - 1.5 * Math.SQRT2 * tau, 2 / 3);

    // Stay inside the unclamped band, r in [0.18, 1.0] * r_fail.
    const r0 = rFail * 0.95;
    const rEnd = rFail * 0.25;
    const tauEnd =
      (Math.pow(r0, 1.5) - Math.pow(rEnd, 1.5)) / (1.5 * Math.SQRT2);

    const h = tauEnd / 4000;
    let checked = 0;

    for (let k = 1; k < 8; k++) {
      const tau = (tauEnd * k) / 8;
      const r = rOfTau(r0, tau);

      const at = (t: number) => suitStrain(rOfTau(r0, t), sun);
      const mid = at(tau);
      const lo = at(tau - h);
      const hi = at(tau + h);

      // Second central difference.
      const d2Radial = (hi.radial - 2 * mid.radial + lo.radial) / (h * h);
      const d2Trans =
        (hi.transverse - 2 * mid.transverse + lo.transverse) / (h * h);

      const expectRadial = (2 / (r * r * r)) * mid.radial;
      const expectTrans = (-1 / (r * r * r)) * mid.transverse;

      // Relative agreement; the finite difference carries O(h^2) error.
      expect(d2Radial / expectRadial).toBeCloseTo(1, 3);
      expect(d2Trans / expectTrans).toBeCloseTo(1, 3);
      checked++;
    }

    expect(checked).toBe(7);
  });

  it("converges the volume as the infalling congruence does", () => {
    // S_r * S_t^2 goes as r^(3/2): the rain congruence contracts, and a
    // deformation that preserved volume would be the wrong one.
    const rFail = tidalFailureRadius(SGR_A);
    const vol = (f: number) => {
      const s = suitStrain(rFail * f, SGR_A);
      return s.radial * s.transverse * s.transverse;
    };
    expect(vol(0.8) / vol(0.4)).toBeCloseTo(Math.pow(2, 1.5), 4);
  });

  it("depends on the mass preset, not on r/r_s alone", () => {
    // The one place the mass changes a pixel. Same radius in units of r_s,
    // completely different rider.
    const r = 2 * 0.5; // 0.5 r_s
    expect(suitStrain(r, STELLAR).failing).toBe(true);
    expect(suitStrain(r, M87).failing).toBe(false);
  });

  it("reports the documented failure threshold", () => {
    // The threshold is a stated convention; if it moves, that is a decision and
    // this test is the place it gets noticed.
    expect(BODY_FAILURE_G).toBe(1000);
    expect(BODY_HEIGHT_M).toBe(1.8);
  });
});
