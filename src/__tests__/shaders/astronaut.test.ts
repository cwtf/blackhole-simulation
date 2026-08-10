import { describe, it, expect } from "vitest";

import { fragmentShaderSource } from "@/shaders/blackhole/fragment.glsl";
import { ASTRONAUT_CHUNK } from "@/shaders/blackhole/chunks/astronaut";

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
    const match = ASTRONAUT_CHUNK.match(/if \(n\.y > (-?[\d.]+)\) return false;/);
    expect(match).not.toBeNull();
    const bound = Number(match![1]);
    expect(bound).toBeLessThan(-0.05);
    expect(bound).toBeGreaterThan(-0.174);
  });

  it("puts the eye on a neck pivot rather than at the eyeball", () => {
    // Looking down has to carry the head forward over the chest, exactly as a
    // real neck does. Without it the torso occludes the whole lower view and
    // there is nothing to see but a white slab.
    expect(ASTRONAUT_CHUNK).toContain("vec3 suit_eye(vec4 look)");
    expect(ASTRONAUT_CHUNK).toMatch(/neck \+ qrot\(look, lever\)/);
  });
});
