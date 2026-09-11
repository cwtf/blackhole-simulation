/**
 * The rider's own EVA suit, seen from inside the helmet (spec §1.6).
 *
 * This is the one object in the 1st-person frame that is NOT lensed, aberrated
 * or Doppler-shifted, and that is not an approximation: the suit is at rest in
 * the observer's frame, one metre from the eye, so light from it crosses a
 * patch of spacetime over which curvature is utterly negligible. It therefore
 * travels in a straight line in the local frame and arrives at the observer's
 * own frequency. Tracing it as ordinary flat-space geometry in the tetrad's
 * spatial coordinates is exact, not a shortcut -- and it gives the viewer a
 * fixed, undistorted reference against which the aberration of everything else
 * is legible.
 *
 * The local frame is the tetrad's own: x = e1 (right), y = e2 (up),
 * z = e3 (forward, which orientFrame defines as inward radial). The eye sits at
 * the origin and distances are metres, which needs no conversion to the
 * geometric units the rest of the shader works in -- the suit never touches the
 * curved geometry, and its angular size is what is being drawn.
 *
 * Free-look rotates the look direction inside this frame, so the suit is fixed
 * to the torso while the head turns: look down and the body is there. That is
 * also why the suit is traced against the post-rotation direction and nothing
 * else needs to move.
 *
 * There is deliberately no helmet rim or visor vignette. A real helmet would
 * crop the periphery, but the 1st-person FOV is fixed and stated (§2.4)
 * precisely so the widened shadow near the horizon stays on screen; darkening
 * the corners would eat the effect the view exists to show.
 */
export const ASTRONAUT_CHUNK = `
  // === RIDER SUIT (1st person) ===

  // Rounded box (Quilez). b is the half-extent before rounding by r.
  float suit_box(vec3 p, vec3 b, float r) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
  }

  // Capsule between a and b.
  float suit_capsule(vec3 p, vec3 a, vec3 b, float r) {
    vec3 pa = p - a;
    vec3 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
  }

  // Capped cylinder along a limb: wrist connectors have flat retaining faces.
  float suit_cylinder(vec3 p, vec3 a, vec3 b, float r) {
    vec3 axis = normalize(b - a);
    vec3 q = p - (a + b) * 0.5;
    float axial = dot(q, axis);
    vec2 d = vec2(length(q - axis * axial) - r, abs(axial) - length(b - a) * 0.5);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  }

  // Nearer of two (distance, material) pairs.
  vec2 suit_union(vec2 a, vec2 b) {
    return a.x < b.x ? a : b;
  }

  // Signed distance to the suit, with a material id in .y:
  //   0 = white outer fabric
  //   1 = dark glove / boot / joint
  //   2 = grey hardware (life-support pack, chest module)
  //   3 = accent stripe
  //   4 = reinforced woven pads
  //   5 = instrument face
  //   6 = status lamp
  //
  // Proportions are an EVA suit on someone of average height, in the posture
  // microgravity actually holds a body in: hips and knees flexed, arms carried
  // forward. Everything is measured in metres from the resting eye position.
  vec2 suit_map(vec3 p) {
    // The suit is symmetric, so one arm and one leg are modelled and the sign
    // of x is folded away.
    vec3 m = vec3(abs(p.x), p.y, p.z);

    // Chest, waist, pelvis.
    //
    // Two things here are load-bearing for the view rather than for the
    // likeness. The waist is narrower than the shoulders, and the chest sits
    // under the chin rather than out in front: the torso's top-front edge is
    // what sets how far down you can see past yourself, and a chest carried
    // forward closes that off completely, leaving a blank white slab wherever
    // the view tips below the shoulders. As placed, that edge sits 0.40 m below
    // the eye and 0.11 m in front of it -- 75 degrees down -- and the head
    // leaning out on its neck pivot then clears it altogether.
    vec2 d = vec2(suit_box(p - vec3(0.0, -0.58, -0.04), vec3(0.17, 0.10, 0.07), 0.08), 0.0);
    d = suit_union(d, vec2(suit_box(p - vec3(0.0, -0.82, 0.00), vec3(0.11, 0.08, 0.07), 0.07), 0.0));
    d = suit_union(d, vec2(suit_box(p - vec3(0.0, -1.02, 0.04), vec3(0.13, 0.05, 0.07), 0.06), 0.0));

    // Life-support pack, behind the shoulders. Mostly out of shot; it shows as
    // a dark edge past the upper arm when looking steeply down.
    d = suit_union(d, vec2(suit_box(p - vec3(0.0, -0.60, -0.26), vec3(0.17, 0.18, 0.05), 0.04), 2.0));

    // Chest-mounted display and control module.
    d = suit_union(d, vec2(suit_box(p - vec3(0.0, -0.64, 0.08), vec3(0.10, 0.05, 0.02), 0.02), 2.0));

    // Arm: shoulder, elbow, glove. Carried forward and up, elbows bent, which
    // is both what an EVA crew member does with their hands and what puts the
    // tops of the gloves just inside the bottom of the resting frame -- so the
    // view reads as a body from the first moment, without having to look down
    // to discover there is one.
    d = suit_union(d, vec2(suit_capsule(m, vec3(0.26, -0.50, -0.03), vec3(0.35, -0.66, 0.28), 0.085), 0.0));
    d = suit_union(d, vec2(max(suit_capsule(m, vec3(0.35, -0.66, 0.28), vec3(0.30, -0.50, 0.62), 0.075), dot(m - vec3(0.306, -0.518, 0.591), normalize(vec3(-0.05, 0.16, 0.34)))), 0.0));
    // Flat wrist-disconnect collars enclose a recessed rubber pressure seal.
    d = suit_union(d, vec2(suit_cylinder(m, vec3(0.306, -0.518, 0.591), vec3(0.296, -0.490, 0.646), 0.074), 1.0));
    d = suit_union(d, vec2(suit_cylinder(m, vec3(0.307, -0.520, 0.587), vec3(0.304, -0.511, 0.608), 0.080), 2.0));
    d = suit_union(d, vec2(suit_cylinder(m, vec3(0.298, -0.496, 0.632), vec3(0.295, -0.487, 0.651), 0.077), 2.0));
    // The hand pitches up at the wrist. Its broad back faces the eye, so
    // the thumb and four relaxed fingers remain legible in first person.
    vec3 hand = m - vec3(0.288, -0.445, 0.700);
    hand.yz = mat2(0.76, 0.65, -0.65, 0.76) * hand.yz;
    d = suit_union(d, vec2(suit_box(hand, vec3(0.039, 0.022, 0.033), 0.019), 0.0));
    d = suit_union(d, vec2(suit_box(hand - vec3(0.0, 0.026, 0.0), vec3(0.032, 0.006, 0.023), 0.010), 4.0));
    d = suit_union(d, vec2(suit_capsule(hand, vec3(-0.041, 0.0, 0.034), vec3(-0.044, 0.0, 0.098), 0.014), 0.0));
    d = suit_union(d, vec2(suit_capsule(hand, vec3(-0.013, 0.0, 0.040), vec3(-0.014, 0.0, 0.111), 0.014), 0.0));
    d = suit_union(d, vec2(suit_capsule(hand, vec3(0.015, 0.0, 0.038), vec3(0.017, -0.003, 0.104), 0.013), 0.0));
    d = suit_union(d, vec2(suit_capsule(hand, vec3(0.041, -0.003, 0.026), vec3(0.046, -0.009, 0.083), 0.012), 0.0));
    d = suit_union(d, vec2(suit_capsule(hand, vec3(-0.044, -0.010, 0.098), vec3(-0.043, -0.026, 0.097), 0.013), 4.0));
    d = suit_union(d, vec2(suit_capsule(hand, vec3(-0.014, -0.010, 0.111), vec3(-0.013, -0.028, 0.109), 0.013), 4.0));
    d = suit_union(d, vec2(suit_capsule(hand, vec3(0.017, -0.013, 0.104), vec3(0.017, -0.028, 0.102), 0.012), 4.0));
    d = suit_union(d, vec2(suit_capsule(hand, vec3(0.046, -0.018, 0.083), vec3(0.043, -0.030, 0.080), 0.011), 4.0));
    d = suit_union(d, vec2(suit_capsule(hand, vec3(-0.047, -0.005, -0.018), vec3(-0.076, -0.004, 0.016), 0.019), 0.0));
    d = suit_union(d, vec2(suit_capsule(hand, vec3(-0.076, -0.004, 0.016), vec3(-0.080, -0.021, 0.047), 0.016), 4.0));
    // Stripe around the upper arm, standing 3 mm proud of it.
    d = suit_union(d, vec2(suit_capsule(m, vec3(0.290, -0.555, 0.075), vec3(0.305, -0.580, 0.115), 0.088), 3.0));

    // Leg: hip, knee, shin, boot. A 0.45 m thigh and a 0.42 m shin, held in the
    // half-seated crouch a body relaxes into with no floor under it, ankles
    // pointed the way free fall leaves them -- toes down and away.
    //
    // The posture is what makes the legs legible, and the reason is
    // perspective rather than anatomy. Seen from the observer's own head the
    // legs point almost straight away, so a leg hanging down compresses into a
    // few degrees of frame -- a stub, with the shin and boot stacked invisibly
    // behind the thigh. Carried forward, the same leg spreads across thirty
    // degrees with each segment in its own band: hip lowest, then knee, shin,
    // and the boots furthest up the frame. It is also, as it happens, the
    // posture every photograph of a floating astronaut shows.
    d = suit_union(d, vec2(suit_capsule(m, vec3(0.16, -1.00, 0.10), vec3(0.185, -1.12, 0.53), 0.095), 0.0));
    d = suit_union(d, vec2(suit_capsule(m, vec3(0.185, -1.12, 0.53), vec3(0.185, -1.36, 0.87), 0.082), 0.0));
    // Insulated boot shell, reinforced toe and a separate rubber outsole.
    d = suit_union(d, vec2(suit_capsule(m, vec3(0.185, -1.34, 0.85), vec3(0.185, -1.41, 0.99), 0.085), 0.0));
    d = suit_union(d, vec2(suit_box(m - vec3(0.185, -1.425, 1.015), vec3(0.058, 0.043, 0.072), 0.035), 0.0));
    d = suit_union(d, vec2(suit_box(m - vec3(0.185, -1.450, 1.074), vec3(0.064, 0.027, 0.027), 0.026), 4.0));
    d = suit_union(d, vec2(suit_box(m - vec3(0.185, -1.487, 1.018), vec3(0.064, 0.010, 0.090), 0.022), 1.0));
    d = suit_union(d, vec2(suit_box(m - vec3(0.185, -1.075, 0.555), vec3(0.058, 0.022, 0.041), 0.022), 4.0));
    // Knee joint band.
    d = suit_union(d, vec2(suit_capsule(m, vec3(0.183, -1.10, 0.52), vec3(0.187, -1.15, 0.545), 0.097), 4.0));

    // Harness webbing and a layered chest controller with guarded switches.
    d = suit_union(d, vec2(suit_box(m - vec3(0.153, -0.626, 0.099), vec3(0.015, 0.102, 0.008), 0.009), 4.0));
    d = suit_union(d, vec2(suit_box(p - vec3(0.0, -0.641, 0.116), vec3(0.080, 0.036, 0.008), 0.009), 5.0));
    d = suit_union(d, vec2(suit_box(p - vec3(-0.033, -0.635, 0.128), vec3(0.027, 0.018, 0.003), 0.003), 2.0));
    d = suit_union(d, vec2(suit_box(m - vec3(0.056, -0.649, 0.131), vec3(0.007, 0.010, 0.005), 0.003), 2.0));
    d = suit_union(d, vec2(length(p - vec3(0.015, -0.624, 0.129)) - 0.005, 6.0));
    // Umbilical ports and a short hose routed along one side of the waist.
    d = suit_union(d, vec2(length(m - vec3(0.104, -0.777, 0.127)) - 0.024, 2.0));
    d = suit_union(d, vec2(suit_capsule(p, vec3(-0.106, -0.790, 0.143), vec3(-0.176, -0.847, 0.173), 0.018), 4.0));
    d = suit_union(d, vec2(suit_capsule(p, vec3(-0.176, -0.847, 0.173), vec3(-0.196, -0.936, 0.111), 0.018), 4.0));
    return d;
  }

  // The tide, applied to the body rather than to the light.
  //
  // u_fp_strain is (transverse, radial): the closed-form geodesic-deviation
  // scale factors from physics/tidal.ts, identity until the tidal load passes
  // what the body can hold together. The radial axis is e3 = z, which
  // orientFrame defines as inward radial -- so the frame looks *along* the
  // stretch, and the rider is drawn out away from the eye rather than head to
  // toe. That is the face-first case, and it is what this frame is.
  vec3 suit_scale() {
    return vec3(u_fp_strain.x, u_fp_strain.x, u_fp_strain.y);
  }

  vec3 suit_normal(vec3 p) {
    vec2 e = vec2(0.0015, 0.0);
    return normalize(vec3(
      suit_map(p + e.xyy).x - suit_map(p - e.xyy).x,
      suit_map(p + e.yxy).x - suit_map(p - e.yxy).x,
      suit_map(p + e.yyx).x - suit_map(p - e.yyx).x
    ));
  }

  // Where the eye actually is when the head has turned.
  //
  // A head pivots at the neck, not at the eyeball, so looking down carries the
  // eyes forward and down as well as aiming them. Ignoring that is what makes
  // a first-person body impossible to see: with the viewpoint pinned at the
  // resting eye position, the torso sits squarely between the observer and
  // every part of the body below it, and looking down gives a blank white
  // slab. Pivoting about the neck leans the head out over the chest exactly
  // as it does in life, and the legs come into view.
  //
  // The lever is the offset from the neck joint to the eye. Only the suit uses
  // this: the world rays keep their exact origin at u_fp_pos, because a 0.2 m
  // translation is beneath any scale the scene resolves -- the geometry is
  // measured in units of M, kilometres at the smallest -- while the suit is
  // measured in metres and is the one thing close enough to notice.
  vec3 suit_eye(vec4 look) {
    const vec3 neck = vec3(0.0, -0.22, -0.08);
    const vec3 lever = vec3(0.0, 0.22, 0.08);
    return neck + qrot(look, lever);
  }

  // Trace the suit along a unit look direction in the observer's own frame.
  // Returns true and writes a linear-light colour when the suit occludes the
  // pixel; the suit is opaque and less than three metres away, so a hit
  // replaces whatever the geodesic march found behind it.
  bool suit_trace(vec3 n, vec4 look, out vec3 col) {
    vec3 s = suit_scale();
    // Evaluate ray derivatives before divergent hit/miss branches.
    float rayFootprint = max(length(dFdx(n)), length(dFdy(n)));

    // Every surface of the model lies below the frame's horizon from any eye
    // position the neck pivot can produce. A search over head orientations and
    // ray directions puts the shallowest hit at n.y = -0.174, with the head
    // craned fully down and the ray going back over the shoulder; -0.12 leaves
    // margin on that. A ray flatter than this cannot reach the body, which
    // keeps the march off most of the screen -- but the bound is measured, not
    // obvious, and has to be re-measured if the model ever grows upward or the
    // neck lever changes.
    //
    // Under strain it has to move. Squeezing the transverse axes by s.x while
    // stretching the radial one by s.y shrinks a hit direction's y component and
    // grows its z component, so hits migrate toward the frame's horizon by
    // roughly s.x/s.y. Keeping the unstrained bound would clip the stretched
    // body off at exactly the moment it becomes the thing worth looking at.
    float cullY = -0.12 * min(1.0, s.x / max(s.y, 1e-3));
    // A compressed torso can rise above the translated eye during free-look.
    // The angular shortcut is valid only without strain; the box below is
    // conservative in both cases and keeps empty rays out of the SDF march.
    if (abs(s.x - 1.0) < 1e-5 && abs(s.z - 1.0) < 1e-5) {
      if (n.y > cullY) return false;
    }

    vec3 eye = suit_eye(look);

    // March in the body's *unstrained* space rather than scaling the field.
    //
    // A non-uniformly scaled distance field is no longer a distance field: it
    // over-reports by up to max(s), so the march has to be throttled to the
    // smallest scale factor and the step count blows up with the squeeze. But an
    // axis-aligned scale is invertible, so the ray can be carried into the frame
    // where suit_map is still exact. p = eye + n*t maps to p/s = eye/s + (n/s)*t,
    // which is a ray with direction n/s; normalising it gives a march parameter
    // u = t*length(n/s) that steps at full stride against the true SDF. Cost is
    // identical to the unstrained trace, and there is no overshoot to guard.
    vec3 dir = n / s;
    float invLen = length(dir);
    vec3 dirN = dir / invLen;
    vec3 eyeU = eye / s;

    // Local-space bounds include the fingertips, pack and layered boot soles.
    vec3 safeDir = mix(vec3(1e-7), dirN, greaterThan(abs(dirN), vec3(1e-7)));
    vec3 boxA = (vec3(-0.47, -1.55, -0.38) - eyeU) / safeDir;
    vec3 boxB = (vec3(0.47, -0.30, 1.15) - eyeU) / safeDir;
    vec3 boxNear = min(boxA, boxB);
    vec3 boxFar = max(boxA, boxB);
    float enter = max(boxNear.x, max(boxNear.y, boxNear.z));
    float leave = min(boxFar.x, min(boxFar.y, boxFar.z));
    if (leave < max(enter, 0.0)) return false;
    float u = max(0.02 * invLen, max(enter, 0.0));
    vec2 h = vec2(1.0, 0.0);
    bool hit = false;
    for (int i = 0; i < 48; i++) {
      h = suit_map(eyeU + dirN * u);
      if (h.x < 0.002) { hit = true; break; }
      u += h.x;
      // The bound is in unstrained space, where the model keeps its own size,
      // so the same 2.8 m reach holds however far the tide draws the body out.
      if (u > 2.8) break;
    }
    if (!hit) return false;

    // Shade in unstrained coordinates -- the fabric stretches with the body, so
    // its mottling and its ambient occlusion belong to the material, not to the
    // deformed shape. Only the normal has to come back: a gradient transforms by
    // the inverse transpose, which for a pure scale is division by s.
    vec3 p = eyeU + dirN * u;
    vec3 nrm = normalize(suit_normal(p) / s);

    vec3 base = vec3(0.76, 0.77, 0.73);
    float gloss = 0.035;
    float specPower = 12.0;
    vec3 materialNormal = normalize(nrm * s);
    if (h.y > 5.5) {
      base = vec3(0.12, 0.60, 0.34);
      gloss = 0.22;
    } else if (h.y > 4.5) {
      base = vec3(0.028, 0.046, 0.054);
      gloss = 0.16;
      specPower = 42.0;
    } else if (h.y > 3.5) {
      base = vec3(0.40, 0.41, 0.35);
      gloss = 0.045;
    } else if (h.y > 2.5) {
      base = vec3(0.44, 0.055, 0.036);
    } else if (h.y > 1.5) {
      base = vec3(0.38, 0.41, 0.42);
      gloss = 0.38;
      specPower = 65.0;
    } else if (h.y > 0.5) {
      base = vec3(0.085, 0.095, 0.104);
      gloss = 0.06;
      specPower = 18.0;
    }
    // Soft thermal-blanket folds and filtered fabric weave. Filtering fades
    // fine threads before they shimmer at distance or under tidal compression.
    float grain = noise(p * 95.0);
    float folds = sin(p.y * 115.0 + 3.5 * noise(p * 16.0) + p.z * 38.0);
    float footprint = (u / invLen) * rayFootprint / min(s.x, s.y);
    float weaveFade = 1.0 - smoothstep(0.0008, 0.004, footprint);
    float weave = sin(p.x * 2300.0) * sin((p.y + p.z) * 2300.0) * weaveFade;
    if (h.y < 0.5 || (h.y > 2.5 && h.y < 4.5)) {
      base *= 0.92 + 0.08 * grain + 0.012 * folds + 0.025 * weave;
      // Gentle normal breakup reads as soft woven fabric instead of plastic.
      vec3 fabricSlope = vec3(0.035 * cos(p.x * 140.0), 0.045 * folds, 0.03 * cos(p.z * 120.0));
      materialNormal = normalize(materialNormal + fabricSlope - materialNormal * dot(materialNormal, fabricSlope));
      nrm = normalize(materialNormal / s);
    }
    // Seams along the sleeves and the boots' moulded tread stay in material space.
    float seam = 1.0 - smoothstep(0.002, 0.005, abs(abs(p.x) - 0.185));
    if (h.y < 0.5 && p.y < -1.0) base *= 1.0 - 0.16 * seam;
    if (h.y > 0.5 && h.y < 1.5 && p.y < -1.46) {
      base *= 0.7 + 0.3 * smoothstep(-0.3, 0.3, sin(p.z * 240.0));
    }

    // The hole is straight ahead by construction: orientFrame takes the
    // forward leg to be the inward radial direction. So the key light comes
    // from +z with the disk's colour, and out here it is the only strong
    // source there is -- the fill is the sky, faint and cold.
    vec3 key = normalize(vec3(0.14, 0.20, 1.0));
    float kd = max(dot(nrm, key), 0.0);
    float fill = 0.5 + 0.5 * nrm.y;
    float spec = pow(max(dot(reflect(-key, nrm), -n), 0.0), specPower) * gloss;

    // Cheap ambient occlusion: creases, and the gaps between limbs and torso,
    // read as one flat white shape without it.
    float ao = clamp(0.28 + 0.72 * suit_map(p + materialNormal * 0.07).x / 0.07, 0.0, 1.0);

    vec3 keyTint = vec3(1.0, 0.82, 0.62);
    vec3 skyTint = vec3(0.42, 0.52, 0.75);

    col = base * keyTint * kd * 0.85;
    col += base * skyTint * fill * 0.24;
    col *= ao;
    col += keyTint * spec * ao;
    col += base * 0.025;
    if (h.y > 5.5) col += vec3(0.025, 0.18, 0.07);

    return true;
  }
`;
