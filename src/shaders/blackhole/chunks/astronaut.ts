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

  // Nearer of two (distance, material) pairs.
  vec2 suit_union(vec2 a, vec2 b) {
    return a.x < b.x ? a : b;
  }

  // Signed distance to the suit, with a material id in .y:
  //   0 = white outer fabric
  //   1 = dark glove / boot / joint
  //   2 = grey hardware (life-support pack, chest module)
  //   3 = accent stripe
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
    d = suit_union(d, vec2(suit_capsule(m, vec3(0.35, -0.66, 0.28), vec3(0.30, -0.50, 0.62), 0.075), 0.0));
    // Glove: lighter than the boots and smaller, which is what tells the two
    // pairs of limbs apart at a glance when all four are in frame.
    d = suit_union(d, vec2(length(m - vec3(0.28, -0.44, 0.70)) - 0.082, 2.0));
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
    d = suit_union(d, vec2(suit_capsule(m, vec3(0.185, -1.34, 0.85), vec3(0.185, -1.42, 1.02), 0.082), 1.0));
    d = suit_union(d, vec2(length(m - vec3(0.185, -1.43, 1.03)) - 0.095, 1.0));
    // Knee joint band.
    d = suit_union(d, vec2(suit_capsule(m, vec3(0.183, -1.10, 0.52), vec3(0.187, -1.15, 0.545), 0.097), 1.0));

    return d;
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
    // Every surface of the model lies below the frame's horizon from any eye
    // position the neck pivot can produce. A search over head orientations and
    // ray directions puts the shallowest hit at n.y = -0.174, with the head
    // craned fully down and the ray going back over the shoulder; -0.12 leaves
    // margin on that. A ray flatter than this cannot reach the body, which
    // keeps the march off most of the screen -- but the bound is measured, not
    // obvious, and has to be re-measured if the model ever grows upward or the
    // neck lever changes.
    if (n.y > -0.12) return false;

    vec3 eye = suit_eye(look);
    float t = 0.02;
    vec2 h = vec2(1.0, 0.0);
    bool hit = false;
    for (int i = 0; i < 48; i++) {
      h = suit_map(eye + n * t);
      if (h.x < 0.002) { hit = true; break; }
      t += h.x;
      if (t > 2.8) break;
    }
    if (!hit) return false;

    vec3 p = eye + n * t;
    vec3 nrm = suit_normal(p);

    vec3 base = vec3(0.80, 0.80, 0.83);
    float gloss = 0.08;
    if (h.y > 2.5) {
      base = vec3(0.55, 0.13, 0.09);   // accent stripe
    } else if (h.y > 1.5) {
      base = vec3(0.26, 0.27, 0.30);   // hardware
      gloss = 0.30;
    } else if (h.y > 0.5) {
      base = vec3(0.13, 0.13, 0.15);   // glove, boot, joint
      gloss = 0.50;
    } else {
      // Faint mottling so the fabric is not a flat plastic white. The noise
      // field is the one the disk already uses; nothing new is uploaded.
      base *= 0.90 + 0.16 * noise(p * 26.0);
    }

    // The hole is straight ahead by construction: orientFrame takes the
    // forward leg to be the inward radial direction. So the key light comes
    // from +z with the disk's colour, and out here it is the only strong
    // source there is -- the fill is the sky, faint and cold.
    vec3 key = normalize(vec3(0.14, 0.20, 1.0));
    float kd = max(dot(nrm, key), 0.0);
    float fill = 0.5 + 0.5 * nrm.y;
    float spec = pow(max(dot(reflect(-key, nrm), -n), 0.0), 26.0) * gloss;

    // Cheap ambient occlusion: creases, and the gaps between limbs and torso,
    // read as one flat white shape without it.
    float ao = clamp(0.28 + 0.72 * suit_map(p + nrm * 0.07).x / 0.07, 0.0, 1.0);

    vec3 keyTint = vec3(1.0, 0.82, 0.62);
    vec3 skyTint = vec3(0.42, 0.52, 0.75);

    col = base * keyTint * kd * 0.85;
    col += base * skyTint * fill * 0.16;
    col *= ao;
    col += keyTint * spec * ao;
    col += base * 0.015;

    return true;
  }
`;
