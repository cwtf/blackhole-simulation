import { describe, it, expect } from "vitest";

import {
  FIRST_PERSON_FOCAL_LENGTH,
  buildRay,
  coordinateBasis,
  CRITICAL_IMPACT_PARAMETER_OVER_M,
  angularMomentum,
  angularMomentumLegs,
  frequencyShift,
  interiorRayIsDark,
  killingEnergy,
  killingLegs,
  lookDirection,
  orientFrame,
  rotateByQuaternion,
  tetradToCartesian,
  toCartesian,
  type CartesianTetrad,
  type Vec3,
} from "@/physics/first-person";

/**
 * Spec §1.6 / §5.
 *
 * The point of these tests is that **nothing in the render path computes
 * aberration**, yet aberration must come out exactly right. So the checks
 * compare `buildRay` — which only adds up tetrad legs — against the closed-form
 * relativistic aberration and Doppler formulas it has never been told about.
 */

/** Map a local look direction back to its source direction in the lab frame. */
function sourceDirection(cosTheta: number, beta: number): number {
  return (cosTheta - beta) / (1 - beta * cosTheta);
}

/**
 * A flat-space frame for an observer moving at `beta` along +z.
 *
 * Written by hand so the test does not depend on the Rust Gram-Schmidt: if
 * both used the same construction, agreeing would prove nothing.
 */
function boostedFrame(beta: number): CartesianTetrad {
  const gamma = 1 / Math.sqrt(1 - beta * beta);
  return {
    e0: { spatial: [0, 0, gamma * beta], time: gamma },
    e1: { spatial: [1, 0, 0], time: 0 },
    e2: { spatial: [0, 1, 0], time: 0 },
    e3: { spatial: [0, 0, gamma], time: gamma * beta },
  };
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe("first-person ray construction", () => {
  it("leaves directions untouched for an observer at rest", () => {
    const frame = boostedFrame(0);
    for (const n of [
      [0, 0, 1],
      [1, 0, 0],
      [0.6, 0, 0.8],
      [0.3, -0.4, Math.sqrt(1 - 0.09 - 0.16)],
    ] as Vec3[]) {
      const { direction } = buildRay(frame, n);
      expect(direction[0]).toBeCloseTo(n[0], 10);
      expect(direction[1]).toBeCloseTo(n[1], 10);
      expect(direction[2]).toBeCloseTo(n[2], 10);
    }
  });

  it("reproduces relativistic aberration without computing it", () => {
    // buildRay only sums -e_0 + n_i e_i. That it lands on the inverse
    // aberration formula is the whole design claim of §5: rendering maps a
    // direction on the observer's sky back to the source in the lab frame.
    for (const beta of [0.1, 0.5, 0.9, 0.99]) {
      const frame = boostedFrame(beta);
      for (const cosLocal of [-0.9, -0.5, 0, 0.5, 0.9]) {
        const sinLocal = Math.sqrt(1 - cosLocal * cosLocal);
        const n: Vec3 = [sinLocal, 0, cosLocal];

        const { direction } = buildRay(frame, n);
        const cosWorld = dot(direction, [0, 0, 1]);

        expect(cosWorld).toBeCloseTo(sourceDirection(cosLocal, beta), 10);
      }
    }
  });

  it("compresses the sky toward the direction of travel", () => {
    // The observable statement of the same thing: at high speed, directions
    // the observer sees spread over the forward hemisphere came from a much
    // wider slice of the sky.
    const beta = 0.95;
    const frame = boostedFrame(beta);

    // A source seen at 90 degrees locally lies behind the lab-frame transverse
    // plane. Its light is aberrated forward on the observer's sky.
    const { direction } = buildRay(frame, [1, 0, 0]);
    const cosWorld = dot(direction, [0, 0, 1]);

    expect(cosWorld).toBeCloseTo(-beta, 10);
    expect(cosWorld).toBeLessThan(0);
  });

  it("keeps directions unit length at every speed", () => {
    for (const beta of [0, 0.3, 0.7, 0.999]) {
      const frame = boostedFrame(beta);
      const { direction } = buildRay(frame, lookDirection(0.4, -0.2));
      expect(Math.hypot(...direction)).toBeCloseTo(1, 12);
    }
  });

  it("produces the relativistic Doppler shift from the same construction", () => {
    // frequencyShift reads p^t, which buildRay assembled from the same legs.
    // No Doppler formula appears in the source.
    const beta = 0.6;
    const gamma = 1 / Math.sqrt(1 - beta * beta);
    const frame = boostedFrame(beta);

    for (const cosLocal of [-1, -0.5, 0, 0.5, 1]) {
      const sinLocal = Math.sqrt(Math.max(0, 1 - cosLocal * cosLocal));
      const ray = buildRay(frame, [sinLocal, 0, cosLocal]);
      // Flat space: r_s = 0, so the lapse is 1 and only motion contributes.
      const shift = frequencyShift(ray, 1, 0);
      expect(shift).toBeCloseTo(1 / (gamma * (1 - beta * cosLocal)), 9);
    }
  });

  it("blueshifts ahead and redshifts behind", () => {
    const frame = boostedFrame(0.6);
    const ahead = frequencyShift(buildRay(frame, [0, 0, 1]), 1, 0);
    const behind = frequencyShift(buildRay(frame, [0, 0, -1]), 1, 0);
    expect(ahead).toBeGreaterThan(1);
    expect(behind).toBeLessThan(1);
  });

  it("folds gravitational redshift into the same number", () => {
    // A static observer deep in the well sees light from infinity blueshifted
    // by 1/sqrt(1 - r_s/r); no separate gravitational term exists in the code.
    const frame = boostedFrame(0);
    const ray = buildRay(frame, [0, 0, 1]);
    const rs = 2;
    for (const r of [4, 10, 100]) {
      expect(frequencyShift(ray, r, rs)).toBeCloseTo(1 / (1 - rs / r), 10);
    }
  });

  it("reports zero shift where the lapse vanishes", () => {
    const frame = boostedFrame(0);
    const ray = buildRay(frame, [0, 0, 1]);
    expect(frequencyShift(ray, 2, 2)).toBe(0);
  });

  it("traces an infaller's side view back outward instead of into the singularity", () => {
    // The observer moves inward along -z. A sideways past-directed ray has an
    // outward +z component; the old +e0 construction gave it an inward one and
    // made every free-look direction black after crossing the horizon.
    const frame = boostedFrame(-0.9);
    const { direction } = buildRay(frame, [1, 0, 0]);
    expect(direction[2]).toBeGreaterThan(0);
  });
});

/**
 * The rain observer's orthonormal frame in ingoing Kerr-Schild coordinates,
 * equatorial, a = 0 — flattened as `e[a][mu]` with mu ordered (t, r, theta,
 * phi), the layout `killingLegs` expects.
 *
 * Written out longhand rather than taken from the Rust Gram-Schmidt for the
 * same reason `boostedFrame` is: if the code under test and the fixture shared
 * a construction, agreeing would prove nothing. With `s = sqrt(2M/r)` the
 * metric determinant of the (t, r) block is exactly -1, which makes the radial
 * leg fall straight out of `e_1^mu = epsilon^{mu nu} u_nu`:
 *
 * ```text
 *   u   = ((1 + s + s^2)/(1 + s),  -s,  0,    0  )
 *   e_r = (-s/(1 + s),              1,  0,    0  )
 * ```
 *
 * Both are regular at s = 1, which is the whole reason the worldline is
 * integrated in this chart and not in Boyer-Lindquist.
 */
function rainFrameKS(r: number, mass: number): number[] {
  const s = Math.sqrt((2 * mass) / r);
  return [
    (1 + s + s * s) / (1 + s),
    -s,
    0,
    0, // e_0 = rain 4-velocity
    -s / (1 + s),
    1,
    0,
    0, // e_1 = outward radial
    0,
    0,
    1 / r,
    0, // e_2 = unit d/dtheta
    0,
    0,
    0,
    1 / r, // e_3 = unit d/dphi (equator)
  ];
}

/** Look direction `theta` off the OUTWARD radial leg, in the e1-e2 plane. */
function lookOffOutward(thetaDeg: number): Vec3 {
  const t = (thetaDeg * Math.PI) / 180;
  return [Math.cos(t), Math.sin(t), 0];
}

/**
 * Half-angle of the dark region, measured from the inward direction, found by
 * bisecting on the sign of the Killing energy rather than by any formula.
 */
function darkConeDeg(r: number, mass: number): number {
  const legs = killingLegs(rainFrameKS(r, mass), r, Math.PI / 2, mass, 0);
  const dark = (deg: number) =>
    killingEnergy(legs, lookOffOutward(180 - deg)) <= 0;
  if (!dark(0)) return 0;
  let lo = 0;
  let hi = 180;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (dark(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

describe("Killing energy inside the horizon", () => {
  const M = 1;
  const RH = 2 * M;

  it("recovers the rain observer's own conserved energy at every radius", () => {
    // -(e_0)_t IS the observer's conserved energy, which for a fall from rest
    // at infinity is exactly 1 — everywhere, horizon included. Nothing else in
    // this file pins the index lowering to the metric; this does, at radii
    // spanning four decades and on both sides of r_h.
    for (const r of [1000, 20, 3, 2.0001, RH, 1, 0.2, 0.04, 0.001]) {
      const legs = killingLegs(rainFrameKS(r, M), r, Math.PI / 2, M, 0);
      expect(-legs[0]).toBeCloseTo(1, 9);
    }
  });

  it("gives the outward leg the local infall speed", () => {
    // The Killing vector's norm fixes this: with (e_0)_t = -1,
    // g_tt = -(1 - 2M/r) forces (e_1)_t^2 = 2M/r.
    for (const r of [50, 4, RH, 0.5, 0.04]) {
      const legs = killingLegs(rainFrameKS(r, M), r, Math.PI / 2, M, 0);
      expect(legs[1]).toBeCloseTo(Math.sqrt((2 * M) / r), 9);
    }
  });

  it("leaves the transverse legs out of it", () => {
    // g_ttheta and g_tphi vanish at a = 0, so looking sideways neither adds
    // nor removes energy. If these picked up a value the dark region would
    // stop being a circle about the radial axis.
    const legs = killingLegs(rainFrameKS(0.5, M), 0.5, Math.PI / 2, M, 0);
    expect(legs[2]).toBeCloseTo(0, 12);
    expect(legs[3]).toBeCloseTo(0, 12);
  });

  it("keeps the whole sky visible outside the horizon", () => {
    // Outside, every direction can be traced back to the exterior universe, so
    // this test must contribute nothing there. The shader gates it on
    // cameraInside as well; this is the belt to that pair of braces.
    for (const r of [100, 10, 2.5, 2.0001]) {
      const legs = killingLegs(rainFrameKS(r, M), r, Math.PI / 2, M, 0);
      for (let deg = 0; deg <= 180; deg += 5) {
        expect(killingEnergy(legs, lookOffOutward(deg))).toBeGreaterThan(0);
      }
    }
  });

  it("darkens nothing at the crossing itself", () => {
    // At r_h the energy test is exactly marginal: E = 1 + cos(theta), which
    // touches zero only looking dead at the singularity. The 42.1 degree
    // shadow that infall-fov.test.ts pins at this radius is the marcher's
    // turning-point behaviour, not this test — the two do different jobs and
    // this one must not double-count.
    //
    // Not exactly zero out of the bisection: the root is the endpoint of the
    // bracket, so it converges from above rather than straddling.
    expect(darkConeDeg(RH, M)).toBeLessThan(1e-5);
  });

  it("closes the cone as arccos(1/beta) on the way down", () => {
    // The prediction: E = 1 + beta*cos(theta) with beta = sqrt(2M/r), so the
    // dark region is a cone of half-angle arccos(1/beta) about the direction
    // of the singularity. Compared against a bisection on the sign, which has
    // never been told the formula.
    for (const r of [1.9, 1.5, 1, 0.5, 0.2, 0.04]) {
      const beta = Math.sqrt((2 * M) / r);
      const expected = (Math.acos(1 / beta) * 180) / Math.PI;
      expect(darkConeDeg(r, M)).toBeCloseTo(expected, 6);
    }
  });

  it("grows the dark region monotonically toward a hemisphere", () => {
    // The failure this whole change exists to prevent is a dark region that
    // SHRINKS as the rider falls, which is what an exterior shadow does when
    // the camera is dragged inside and nothing else changes.
    const radii = [RH, 1.5, 1, 0.5, 0.2, 0.04, 0.004];
    const cones = radii.map((r) => darkConeDeg(r, M));
    for (let i = 1; i < cones.length; i++) {
      expect(cones[i]!).toBeGreaterThan(cones[i - 1]!);
    }
    // Half the sky at the singularity, approached from below and never passed.
    expect(cones[cones.length - 1]!).toBeGreaterThan(85);
    expect(Math.max(...cones)).toBeLessThan(90);
  });

  it("puts the interior stopping radius at four tenths of the sky", () => {
    // 0.02 r_s = 0.04 M is where worldline.rs stops an interior ride, so this
    // is the frame the rider actually ends on: 81.9 degrees of dark cone,
    // 43% of the sky. The screenshot that prompted this change had roughly
    // 12 degrees, about 1%.
    const cone = darkConeDeg(0.04 * M, M);
    expect(cone).toBeCloseTo(81.87, 1);
    const fraction = (1 + Math.cos(((180 - cone) * Math.PI) / 180)) / 2;
    expect(fraction).toBeGreaterThan(0.42);
  });
});

describe("the barrier half of the interior test", () => {
  const M = 1;
  const RH = 2 * M;
  const BC = CRITICAL_IMPACT_PARAMETER_OVER_M * M;

  /** Impact parameter b = L/E for a look direction `theta` off outward. */
  function impactParameter(r: number, thetaDeg: number): number {
    const t = rainFrameKS(r, M);
    const n = lookOffOutward(thetaDeg);
    const E = killingEnergy(killingLegs(t, r, Math.PI / 2, M, 0), n);
    return angularMomentum(angularMomentumLegs(t, r, Math.PI / 2, M, 0), n) / E;
  }

  it("matches the closed form for a rain observer", () => {
    // b = r sin(psi) / (1 - beta cos psi) with psi the photon's propagation
    // angle off outward, which is 180 - theta for a look direction theta.
    // Derived from the metric; the code only ever adds up tetrad legs.
    for (const r of [1.9, 1.5, 1, 0.4]) {
      const beta = Math.sqrt((2 * M) / r);
      for (const deg of [10, 40, 70, 100]) {
        const psi = ((180 - deg) * Math.PI) / 180;
        const expected = (r * Math.sin(psi)) / (1 - beta * Math.cos(psi));
        expect(impactParameter(r, deg)).toBeCloseTo(expected, 6);
      }
    }
  });

  it("puts the crossing shadow at 42.1 degrees, where the energy test is blind", () => {
    // The number infall-fov.test.ts pins. At r_h the energy test darkens
    // nothing at all, so this is the whole shadow — and it used to come from
    // the marcher, which has since been shown to supply none of it.
    const legs = killingLegs(rainFrameKS(RH, M), RH, Math.PI / 2, M, 0);
    const amom = angularMomentumLegs(rainFrameKS(RH, M), RH, Math.PI / 2, M, 0);
    const dark = (deg: number) => {
      const n = lookOffOutward(180 - deg);
      return interiorRayIsDark(
        killingEnergy(legs, n),
        angularMomentum(amom, n),
        BC,
      );
    };
    let lo = 0;
    let hi = 180;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (dark(mid)) lo = mid;
      else hi = mid;
    }
    expect(lo).toBeCloseTo(42.1, 1);
  });

  it("is exactly the b = b_crit criterion wherever the energy test abstains", () => {
    // Where E > 0 the predicate must agree, direction by direction, with a
    // separately computed |b| against b_crit — b_crit being the ray that
    // asymptotes to the photon sphere rather than clearing it.
    for (const r of [1.95, 1.6, 1.2, 0.8]) {
      const legs = killingLegs(rainFrameKS(r, M), r, Math.PI / 2, M, 0);
      const amom = angularMomentumLegs(rainFrameKS(r, M), r, Math.PI / 2, M, 0);
      let checked = 0;
      for (let deg = 0; deg <= 180; deg += 0.5) {
        const n = lookOffOutward(deg);
        const E = killingEnergy(legs, n);
        if (E <= 0) continue; // the energy test owns these
        checked++;
        expect(
          interiorRayIsDark(E, angularMomentum(amom, n), BC),
          `r=${r} deg=${deg} b=${impactParameter(r, deg).toFixed(3)}`,
        ).toBe(Math.abs(impactParameter(r, deg)) > BC);
      }
      expect(checked).toBeGreaterThan(50);
    }
  });

  it("neither test alone is enough", () => {
    // The point of carrying both. At the crossing the energy test sees
    // nothing; deep in, the barrier test is a rounding error next to it.
    const sweep = (r: number) => {
      const legs = killingLegs(rainFrameKS(r, M), r, Math.PI / 2, M, 0);
      const amom = angularMomentumLegs(rainFrameKS(r, M), r, Math.PI / 2, M, 0);
      let byEnergy = 0;
      let byBarrier = 0;
      let n = 0;
      for (let i = 0; i < 2000; i++) {
        // Uniform in cos so this is a genuine solid-angle fraction.
        const c = -1 + (2 * (i + 0.5)) / 2000;
        const dir: Vec3 = [c, Math.sqrt(1 - c * c), 0];
        const E = killingEnergy(legs, dir);
        const L = angularMomentum(amom, dir);
        n++;
        if (E <= 0) byEnergy++;
        else if (L > BC * E) byBarrier++;
      }
      return { energy: byEnergy / n, barrier: byBarrier / n };
    };

    const atCrossing = sweep(RH);
    expect(atCrossing.energy).toBeCloseTo(0, 3);
    expect(atCrossing.barrier).toBeGreaterThan(0.1);

    const deep = sweep(0.04);
    expect(deep.energy).toBeGreaterThan(0.4);
    expect(deep.barrier).toBeLessThan(0.01);
  });

  it("never shrinks the dark region as the rider falls", () => {
    const frac = (r: number) => {
      const legs = killingLegs(rainFrameKS(r, M), r, Math.PI / 2, M, 0);
      const amom = angularMomentumLegs(rainFrameKS(r, M), r, Math.PI / 2, M, 0);
      let dark = 0;
      for (let i = 0; i < 4000; i++) {
        const c = -1 + (2 * (i + 0.5)) / 4000;
        const dir: Vec3 = [c, Math.sqrt(1 - c * c), 0];
        if (
          interiorRayIsDark(
            killingEnergy(legs, dir),
            angularMomentum(amom, dir),
            BC,
          )
        )
          dark++;
      }
      return dark / 4000;
    };
    const radii = [RH, 1.6, 1.2, 0.8, 0.4, 0.1, 0.04];
    const fracs = radii.map(frac);
    for (let i = 1; i < fracs.length; i++) {
      expect(fracs[i]!).toBeGreaterThan(fracs[i - 1]!);
    }
    // 13% at the crossing is the 42.1 degree cone; ~43% at the stop is the
    // energy test's hemisphere.
    expect(fracs[0]!).toBeCloseTo(0.129, 2);
    expect(fracs[fracs.length - 1]!).toBeGreaterThan(0.42);
  });
});

describe("first-person sky tone response", () => {
  // The GLSL is log(1 + boost*K)/log(1 + K); mirrored here so its contract can
  // be pinned. What broke was not the level but the flat top: clamp(g^4, 0, 64)
  // mapped every boost above 2.83 onto one value, and at r = 1.19M the whole
  // frame was above it.
  const KNEE = 100;
  const shaped = (boost: number) =>
    Math.log(1 + boost * KNEE) / Math.log(1 + KNEE);

  it("leaves an unshifted ray exactly alone", () => {
    expect(shaped(1)).toBeCloseTo(1, 12);
  });

  it("is strictly increasing, so no two brightnesses collapse together", () => {
    let prev = -Infinity;
    for (let e = -3; e <= 12; e += 0.25) {
      const v = shaped(Math.pow(10, e));
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it("keeps redshift below unity and blueshift above it", () => {
    expect(shaped(Math.pow(0.45, 4))).toBeLessThan(1); // looking back outward
    expect(shaped(Math.pow(2.0, 4))).toBeGreaterThan(1); // toward the rim
  });

  it("fits the range an interior frame actually spans into a few stops", () => {
    // At r = 1.19M the boost runs from 16.7 at the frame corner to unbounded
    // at the dark boundary. The old clamp put all of that on one number.
    const corner = shaped(16.7);
    const rim = shaped(1e12);
    expect(rim / corner).toBeLessThan(6);
    expect(rim).toBeGreaterThan(corner * 1.5);
  });
});

describe("coordinate basis", () => {
  it("puts the equator in the shader's x-z plane with y as the spin axis", () => {
    const p = toCartesian(5, Math.PI / 2, 0);
    expect(p[0]).toBeCloseTo(5, 10);
    expect(p[1]).toBeCloseTo(0, 10);
    expect(p[2]).toBeCloseTo(0, 10);

    // The pole is along +y.
    const pole = toCartesian(5, 0, 0);
    expect(pole[1]).toBeCloseTo(5, 10);
  });

  it("gives d/dr as the outward unit vector", () => {
    const { dr } = coordinateBasis(7, 1.1, 0.4);
    expect(Math.hypot(...dr)).toBeCloseTo(1, 10);
    const pos = toCartesian(7, 1.1, 0.4);
    const radial: Vec3 = [pos[0] / 7, pos[1] / 7, pos[2] / 7];
    expect(dot(dr, radial)).toBeCloseTo(1, 10);
  });

  it("makes the basis vectors mutually orthogonal", () => {
    const { dr, dtheta, dphi } = coordinateBasis(3, 0.9, 2.2);
    expect(dot(dr, dtheta)).toBeCloseTo(0, 9);
    expect(dot(dr, dphi)).toBeCloseTo(0, 9);
    expect(dot(dtheta, dphi)).toBeCloseTo(0, 9);
  });

  it("scales d/dtheta by r and d/dphi by r sin(theta)", () => {
    const r = 4;
    const theta = 0.7;
    const { dtheta, dphi } = coordinateBasis(r, theta, 1.3);
    expect(Math.hypot(...dtheta)).toBeCloseTo(r, 9);
    expect(Math.hypot(...dphi)).toBeCloseTo(r * Math.sin(theta), 9);
  });

  it("resolves a coordinate tetrad into Cartesian legs", () => {
    // A static equatorial observer's frame: e_0 along d/dt, e_1 along d/dr.
    const r = 10;
    const theta = Math.PI / 2;
    const phi = 0;
    const flat = [
      1,
      0,
      0,
      0, // e_0 = d/dt
      0,
      1,
      0,
      0, // e_1 = d/dr
      0,
      0,
      1 / r,
      0, // e_2 = unit d/dtheta
      0,
      0,
      0,
      1 / r, // e_3 = unit d/dphi (equator)
    ];
    const frame = tetradToCartesian(flat, r, theta, phi);

    // Purely temporal leg has no spatial part.
    expect(Math.hypot(...frame.e0.spatial)).toBeCloseTo(0, 10);
    expect(frame.e0.time).toBeCloseTo(1, 10);

    // Radial leg points along +x at phi = 0.
    expect(frame.e1.spatial[0]).toBeCloseTo(1, 10);

    // The normalised angular legs come out unit length.
    expect(Math.hypot(...frame.e2.spatial)).toBeCloseTo(1, 10);
    expect(Math.hypot(...frame.e3.spatial)).toBeCloseTo(1, 10);
  });
});

describe("free-look", () => {
  it("leaves directions alone for the identity quaternion", () => {
    const v: Vec3 = [0.3, -0.5, 0.8];
    const r = rotateByQuaternion(v, [0, 0, 0, 1]);
    expect(r[0]).toBeCloseTo(v[0], 12);
    expect(r[1]).toBeCloseTo(v[1], 12);
    expect(r[2]).toBeCloseTo(v[2], 12);
  });

  it("preserves length", () => {
    const q: [number, number, number, number] = [0.2, 0.3, 0.1, 0.927];
    const n = Math.hypot(...q);
    const unit: [number, number, number, number] = [
      q[0] / n,
      q[1] / n,
      q[2] / n,
      q[3] / n,
    ];
    const v: Vec3 = [1, 2, 3];
    const r = rotateByQuaternion(v, unit);
    expect(Math.hypot(...r)).toBeCloseTo(Math.hypot(...v), 9);
  });

  it("rotates 90 degrees about y as expected", () => {
    const s = Math.SQRT1_2;
    const r = rotateByQuaternion([0, 0, 1], [0, s, 0, s]);
    expect(r[0]).toBeCloseTo(1, 9);
    expect(r[1]).toBeCloseTo(0, 9);
    expect(r[2]).toBeCloseTo(0, 9);
  });

  it("applies inside the frame, so aberration is not carried around with the view", () => {
    // Free-look must change WHICH ray you look along, not where the forward
    // compression sits. Looking sideways while moving forward must still show
    // the sky bunched toward the direction of travel.
    const beta = 0.9;
    const frame = boostedFrame(beta);

    const sideways = rotateByQuaternion(
      [0, 0, 1],
      [0, Math.SQRT1_2, 0, Math.SQRT1_2],
    );
    const { direction } = buildRay(frame, sideways);

    // The source direction in the lab leans opposite +z; aberration carries
    // that source forward onto the moving observer's local sky.
    expect(direction[2]).toBeCloseTo(-beta, 9);
    expect(direction[2]).toBeLessThan(0);
  });
});

describe("frame orientation", () => {
  /** Tetrad rows e[a][mu], mu = (t, r, theta, phi). */
  function frame(rows: number[][]): number[] {
    return rows.flat();
  }

  it("identifies the legs regardless of Gram-Schmidt order", () => {
    // Order as produced for an orbiting observer: radial, azimuthal, polar.
    const orbiting = frame([
      [1, 0, 0, 0],
      [0, 1, 0, 0], // radial
      [0, 0, 0, 1], // azimuthal
      [0, 0, 1, 0], // polar
    ]);
    const a = orientFrame(orbiting);
    expect(a.forward.index).toBe(1);
    expect(a.up.index).toBe(3);
    expect(a.right.index).toBe(2);

    // A different order must still be identified correctly — this is the
    // case that put the camera 90 degrees off the hole.
    const shuffled = frame([
      [1, 0, 0, 0],
      [0, 0, 1, 0], // polar
      [0, 0, 0, 1], // azimuthal
      [0, 1, 0, 0], // radial
    ]);
    const b = orientFrame(shuffled);
    expect(b.forward.index).toBe(3);
    expect(b.up.index).toBe(1);
    expect(b.right.index).toBe(2);
  });

  it("points forward inward, whichever way the radial leg was built", () => {
    // Outward-pointing radial leg must be flipped so the hole is in shot.
    const outward = frame([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 0, 1],
      [0, 0, 1, 0],
    ]);
    expect(orientFrame(outward).forward.sign).toBe(-1);

    const inward = frame([
      [1, 0, 0, 0],
      [0, -1, 0, 0],
      [0, 0, 0, 1],
      [0, 0, 1, 0],
    ]);
    expect(orientFrame(inward).forward.sign).toBe(1);
  });

  it("always assigns three distinct legs", () => {
    // Mixed legs, as a boosted or infalling frame produces.
    const mixed = frame([
      [1.2, 0.3, 0, 0.1],
      [0.4, 0.9, 0.1, 0.2],
      [0.1, 0.2, 0.3, 0.9],
      [0.0, 0.1, 0.95, 0.1],
    ]);
    const a = orientFrame(mixed);
    const indices = [a.right.index, a.up.index, a.forward.index].sort();
    expect(indices).toEqual([1, 2, 3]);
  });

  it("sends the default view toward the hole, not out of the orbital plane", () => {
    // The regression: forward must have a radial character, never polar.
    const orbiting = frame([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 0, 1],
      [0, 0, 1, 0],
    ]);
    const { forward } = orientFrame(orbiting);
    // The chosen leg's dominant coordinate component must be ∂r (index 1).
    const leg = orbiting.slice(forward.index * 4, forward.index * 4 + 4);
    const dominant = leg.indexOf(Math.max(...leg.map(Math.abs)));
    expect(dominant).toBe(1);
  });
});

describe("field of view", () => {
  it("is fixed, because a variable FOV would masquerade as aberration", () => {
    expect(FIRST_PERSON_FOCAL_LENGTH).toBe(1.2);
  });

  it("builds unit look directions", () => {
    for (const [u, v] of [
      [0, 0],
      [0.5, 0.3],
      [-0.8, 0.9],
    ]) {
      expect(Math.hypot(...lookDirection(u!, v!))).toBeCloseTo(1, 12);
    }
  });

  it("points straight ahead at the centre of the screen", () => {
    const d = lookDirection(0, 0);
    expect(d[0]).toBeCloseTo(0, 12);
    expect(d[1]).toBeCloseTo(0, 12);
    expect(d[2]).toBeCloseTo(1, 12);
  });
});
