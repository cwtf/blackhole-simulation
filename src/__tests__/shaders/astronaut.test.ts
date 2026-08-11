import { describe, it, expect } from "vitest";

import { fragmentShaderSource } from "@/shaders/blackhole/fragment.glsl";
import { ASTRONAUT_CHUNK } from "@/shaders/blackhole/chunks/astronaut";
import { MIN_TRANSVERSE_SQUEEZE, NO_STRAIN } from "@/physics/tidal";
import { rotateByQuaternion, type Vec3 } from "@/physics/first-person";

/**
 * The rider's suit (spec §1.6).
 *
 * Everything here guards a property that is invisible in a screenshot: that
 * the suit cannot touch the 3rd-person image, that it cannot cost anything on
 * the pixels it does not cover, and that it is drawn in the observer's own
 * frame rather than in world space.
 */
describe("astronaut suit", () => {
  it("is assembled into the fragment shader", () => {
    expect(fragmentShaderSource).toContain("suit_map");
    expect(fragmentShaderSource).toContain("suit_trace");
    expect(fragmentShaderSource).toContain("u_fp_body");
  });

  it("draws only in 1st person, and only when switched on", () => {
    // Every call site must be behind both gates. A suit that rendered in 3rd
    // person would be a body hanging in front of a camera that has none.
    // Matches invocations, not the declaration in the chunk.
    const calls = [...fragmentShaderSource.matchAll(/suit_trace\(fpLocalDir/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      // The gate opens a block, and the call is inside it: a few statements at
      // most separate them, and nothing closes the block in between.
      const between = fragmentShaderSource.slice(
        fragmentShaderSource
          .slice(0, call.index)
          .lastIndexOf("if (firstPerson && u_fp_body > 0.5"),
        call.index,
      );
      expect(between.startsWith("if (firstPerson && u_fp_body > 0.5")).toBe(true);
      expect(between).not.toContain("}");
    }
  });

  it("is traced through the local look direction, not the world ray", () => {
    // The suit rides with the observer: it is at rest in the tetrad frame and
    // suffers no aberration, no shift and no lensing. Tracing it with the
    // world-space ray -- which has been lifted through the tetrad and bent by
    // the geometry -- would apply all three to a thing one metre away.
    expect(fragmentShaderSource).toContain("suit_trace(fpLocalDir, u_fp_look");
    expect(fragmentShaderSource).toMatch(/fpLocalDir\s*=\s*n;/);
  });

  it("short-circuits the geodesic march on the pixels it covers", () => {
    // The suit is opaque, so a covered pixel has nothing to integrate. The
    // test is positional: the trace must come before the marching loop and
    // return, or the body becomes the most expensive part of the frame
    // instead of the cheapest.
    const trace = fragmentShaderSource.indexOf("suit_trace(fpLocalDir");
    const loop = fragmentShaderSource.indexOf("for(int i = 0; i < maxSteps; i++)");
    expect(trace).toBeGreaterThan(-1);
    expect(loop).toBeGreaterThan(-1);
    expect(trace).toBeLessThan(loop);
  });

  it("leaves the redshift diagnostic alone", () => {
    // That overlay colours each pixel by the potential its ray sampled. A
    // pixel of suit has no ray, so it has no honest value to show.
    expect(fragmentShaderSource).toContain(
      "firstPerson && u_fp_body > 0.5 && u_show_redshift < 0.5",
    );
  });

  it("keeps the early-out bound that was measured, not guessed", () => {
    // A search over head orientations and ray directions put the shallowest
    // ray that can still reach the suit at n.y = -0.174. The bound in the
    // shader has to stay below that or the body is clipped along a hard line;
    // it also must not drift to 0, which would march every pixel on screen.
    const match = ASTRONAUT_CHUNK.match(/cullY = (-?[\d.]+) \*/);
    expect(match).not.toBeNull();
    const bound = Number(match![1]);
    expect(bound).toBeLessThan(-0.05);
    expect(bound).toBeGreaterThan(-0.174);
    expect(ASTRONAUT_CHUNK).toContain("if (n.y > cullY) return false;");
  });

  it("puts the eye on a neck pivot rather than at the eyeball", () => {
    // Looking down has to carry the head forward over the chest, exactly as a
    // real neck does. Without it the torso occludes the whole lower view and
    // there is nothing to see but a white slab.
    expect(ASTRONAUT_CHUNK).toContain("vec3 suit_eye(vec4 look)");
    expect(ASTRONAUT_CHUNK).toMatch(/neck \+ qrot\(look, lever\)/);
  });
});

/**
 * Spec §1.6: the tide deforms the rider, not the sky.
 *
 * These guard the two things that are easy to get quietly wrong — marching a
 * scaled distance field as though it were still a distance field, and forgetting
 * that a normal does not transform like a point.
 */
describe("suit tidal strain", () => {
  it("takes the deformation as a uniform rather than deriving it in GLSL", () => {
    // The closed form lives in physics/tidal.ts, where it is testable against
    // the geodesic deviation equation. A shader-side reimplementation could not
    // be checked against anything.
    expect(fragmentShaderSource).toContain("uniform vec2 u_fp_strain");
    expect(ASTRONAUT_CHUNK).toContain("u_fp_strain");
  });

  it("stretches the radial axis and squeezes both transverse ones", () => {
    // suit_scale must be (transverse, transverse, radial): x = e1 azimuthal,
    // y = e2 polar, z = e3 inward radial. Putting the stretch on y would draw
    // the body out head-to-toe, which is the feet-first case and not this frame.
    expect(ASTRONAUT_CHUNK).toMatch(
      /vec3\s+suit_scale\(\)\s*\{\s*return\s+vec3\(u_fp_strain\.x,\s*u_fp_strain\.x,\s*u_fp_strain\.y\)/,
    );
  });

  it("marches in unstrained space so the distance field stays exact", () => {
    // A non-uniform scale is not an isometry, so suit_map(p / s) over-reports
    // distance and a march on it overshoots. Carrying the ray into the body's
    // own frame keeps suit_map exact and the step count unchanged. The tell is
    // that the ray direction is divided by the scale and renormalised.
    expect(ASTRONAUT_CHUNK).toContain("vec3 dir = n / s;");
    expect(ASTRONAUT_CHUNK).toMatch(/dirN\s*=\s*dir\s*\/\s*invLen/);
    expect(ASTRONAUT_CHUNK).toMatch(/eyeU\s*=\s*eye\s*\/\s*s/);
    expect(ASTRONAUT_CHUNK).toContain("suit_map(eyeU + dirN * u)");
    // And no scaled-field variant survives anywhere.
    expect(ASTRONAUT_CHUNK).not.toContain("suit_map_strained");
  });

  it("keeps the same step budget it had before the tide existed", () => {
    // The whole reason for the ray transform: the suit must not become the most
    // expensive thing on screen when it deforms.
    const loops = [...ASTRONAUT_CHUNK.matchAll(/for \(int i = 0; i < (\d+); i\+\+\)/g)];
    expect(loops.length).toBe(1);
    expect(Number(loops[0]![1])).toBeLessThanOrEqual(48);
  });

  it("transforms the normal by the inverse scale, not the scale", () => {
    // Gradients transform by the inverse transpose. For a pure scale that is a
    // division; multiplying instead tilts every highlight the wrong way and is
    // invisible until the strain is large.
    expect(ASTRONAUT_CHUNK).toMatch(
      /normalize\(suit_normal\(p\)\s*\/\s*s\)/,
    );
  });

  it("loosens the early-out as the body stretches toward the frame centre", () => {
    // Squeezing y while stretching z moves hits toward n.y = 0. A fixed bound
    // would clip the stretched body off precisely when it matters.
    expect(ASTRONAUT_CHUNK).toMatch(
      /cullY = -[\d.]+ \* min\(1\.0, s\.x \/ max\(s\.y/,
    );
  });

  it("never divides by a zero scale", () => {
    // suit_trace divides by s twice. The floor lives in physics/tidal.ts, and
    // the renderer's 3rd-person branch has to send identity rather than zeroes.
    expect(MIN_TRANSVERSE_SQUEEZE).toBeGreaterThan(0);
    expect(NO_STRAIN.transverse).toBe(1);
    expect(NO_STRAIN.radial).toBe(1);
  });
});

/**
 * The ray transform in `suit_trace`, checked arithmetically.
 *
 * Compiling proves the GLSL is well-formed, not that it points the right way —
 * and a scale inverted here would squash the body instead of stretching it,
 * which is exactly the kind of error that survives a screenshot. So the few
 * lines the shader performs are reproduced and their invariant asserted:
 * a ray aimed at where a deformed body point *appears* must, after the
 * transform, pass through that point's undeformed position.
 */
describe("suit strain ray transform", () => {
  // suit_eye: neck + qrot(look, lever), from the chunk.
  const NECK: Vec3 = [0, -0.22, -0.08];
  const LEVER: Vec3 = [0, 0.22, 0.08];
  const suitEye = (look: [number, number, number, number]): Vec3 => {
    const l = rotateByQuaternion(LEVER, look);
    return [NECK[0] + l[0], NECK[1] + l[1], NECK[2] + l[2]];
  };

  // Representative extremities of the model, straight out of suit_map.
  const POINTS: Record<string, Vec3> = {
    chest: [0, -0.58, -0.04],
    pack: [0, -0.6, -0.26],
    pelvis: [0, -1.02, 0.04],
    glove: [0.28, -0.44, 0.7],
    knee: [0.185, -1.12, 0.53],
    boot: [0.185, -1.43, 1.03],
  };

  const scaleOf = (t: number, r: number): Vec3 => [t, t, r];
  const mul = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
  const div = (a: Vec3, b: Vec3): Vec3 => [a[0] / b[0], a[1] / b[1], a[2] / b[2]];
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a: Vec3): Vec3 => {
    const n = norm(a);
    return [a[0] / n, a[1] / n, a[2] / n];
  };
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];

  const STRAINS: Array<[number, number]> = [
    [1, 1],
    [0.8, 1.12],
    [0.5, 1.41],
    [0.3, 1.83],
    [0.18, 6],
  ];

  const LOOKS: Array<[number, number, number, number]> = [
    [0, 0, 0, 1],
    // ~35 degrees of pitch, which is where the legs come into frame.
    [Math.sin(-0.305), 0, 0, Math.cos(-0.305)],
  ];

  it("carries a ray aimed at the deformed body back to the undeformed point", () => {
    for (const look of LOOKS) {
      const eye = suitEye(look);
      for (const [t, r] of STRAINS) {
        const s = scaleOf(t, r);
        for (const [name, pb] of Object.entries(POINTS)) {
          // Where that material point actually is once the tide has acted.
          const seen = mul(pb, s);
          // The screen direction that looks at it.
          const n = unit(sub(seen, eye));
          // The shader's transform, verbatim.
          const dir = div(n, s);
          const eyeU = div(eye, s);
          // The invariant: the transformed ray must pass through pb exactly.
          const toPoint = sub(pb, eyeU);
          const perp = norm(cross(unit(dir), unit(toPoint)));
          expect(perp).toBeLessThan(1e-12);
          // …and forward along it, never behind the eye.
          const along =
            dir[0] * toPoint[0] + dir[1] * toPoint[1] + dir[2] * toPoint[2];
          expect(along, `${name} at strain ${t}/${r}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("stretches away from the eye rather than across the frame", () => {
    // The frame looks along the radius, so radial stretch is foreshortened: a
    // forward point recedes and its direction swings toward the frame axis.
    // If the scale were applied to y instead, boot.y would grow, not shrink.
    const eye = suitEye([0, 0, 0, 1]);
    const relaxed = unit(sub(mul(POINTS.boot!, scaleOf(1, 1)), eye));
    const strained = unit(sub(mul(POINTS.boot!, scaleOf(0.18, 6)), eye));
    expect(Math.abs(strained[1])).toBeLessThan(Math.abs(relaxed[1]));
    expect(strained[2]).toBeGreaterThan(relaxed[2]);
    // And the boot really is further away in physical terms.
    expect(norm(sub(mul(POINTS.boot!, scaleOf(0.18, 6)), eye))).toBeGreaterThan(
      norm(sub(POINTS.boot!, eye)),
    );
  });

  it("keeps every extremity inside the strain-aware early-out", () => {
    // The cull is the one place the deformation could silently clip the body.
    // -0.12 * min(1, s.x/s.y) has to stay below the shallowest hit at every
    // strain, or the stretched suit gets sliced along a horizontal line.
    for (const look of LOOKS) {
      const eye = suitEye(look);
      for (const [t, r] of STRAINS) {
        const s = scaleOf(t, r);
        const cullY = -0.12 * Math.min(1, s[0] / Math.max(s[2], 1e-3));
        for (const [name, pb] of Object.entries(POINTS)) {
          const n = unit(sub(mul(pb, s), eye));
          expect(n[1], `${name} culled at strain ${t}/${r}`).toBeLessThan(cullY);
        }
      }
    }
  });
});
