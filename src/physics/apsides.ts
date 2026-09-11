/**
 * Draggable orbits: the *preview* half (spec §6.3, milestone 9).
 *
 * Everything relativistic about an apsis pair lives in Rust
 * (`physics/apsides.rs`) and is reached through `physicsBridge.solveApsides`.
 * What is here is deliberately only what must run at pointer-move rate:
 *
 * - the **Newtonian ellipse** drawn while a handle is being dragged, which §6.3
 *   asks for explicitly ("preview the ellipse during the drag with a cheap
 *   Newtonian approximation clearly marked as a preview"), because
 *   re-integrating a geodesic per pointer-move is not affordable;
 * - the arithmetic converting a screen drag into a radius.
 *
 * The preview is wrong on purpose, and the UI says so. A real orbit precesses:
 * the drawn ellipse closes, and the integrated one does not. That gap is
 * visible the instant the drag ends and the true trajectory replaces it, which
 * is a better demonstration of relativistic precession than any label.
 */

export interface ApsisPair {
  /** Inner turning point, in units of M. */
  periapsis: number;
  /** Outer turning point, in units of M. */
  apoapsis: number;
  /** Angle from the ascending node to apoapsis in the initial orbit plane. */
  argument: number;
  /** Initial plane tilt away from the black-hole equator, in radians. */
  inclination: number;
  /** Azimuth of the ascending-node axis around the +Y spin axis, in radians. */
  ascendingNode: number;
  /** Additional plane rotation about the apoapsis/periapsis axis. */
  apsidalRotation: number;
}

export const DEFAULT_APSIDES: ApsisPair = {
  periapsis: 10,
  apoapsis: 20,
  argument: 0,
  inclination: 0,
  ascendingNode: 0,
  apsidalRotation: 0,
};

export function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  const wrapped = angle % (Math.PI * 2);
  return wrapped < 0 ? wrapped + Math.PI * 2 : wrapped;
}

/** Order a dragged pair. §6.3: dragging one handle past the other swaps them. */
export function orderApsides(
  a: number,
  b: number,
  orientation: Partial<Omit<ApsisPair, "periapsis" | "apoapsis">> = {},
): ApsisPair {
  return {
    periapsis: Math.min(a, b),
    apoapsis: Math.max(a, b),
    argument: normalizeAngle(orientation.argument ?? 0),
    inclination: Math.max(
      0,
      Math.min(Math.PI / 2, orientation.inclination ?? 0),
    ),
    ascendingNode: normalizeAngle(orientation.ascendingNode ?? 0),
    apsidalRotation: Math.max(
      -Math.PI / 2,
      Math.min(Math.PI / 2, orientation.apsidalRotation ?? 0),
    ),
  };
}

export type OrbitBasis = {
  /** Ascending-node direction in the equatorial plane. */
  node: [number, number, number];
  /** In-plane direction 90 degrees from the ascending node. */
  transverse: [number, number, number];
  normal: [number, number, number];
  /** Direction from the hole to apoapsis. */
  major: [number, number, number];
  /** In-plane direction 90 degrees from the major axis. */
  minor: [number, number, number];
};

/** Initial/osculating orbit basis in the renderer's Y-up frame. */
export function orbitBasis(pair: ApsisPair): OrbitBasis {
  const clean = (value: number) => (Math.abs(value) < 1e-15 ? 0 : value);
  const vec = (values: [number, number, number]) =>
    values.map(clean) as [number, number, number];
  const nodeAngle = pair.ascendingNode;
  const inclination = pair.inclination;
  const argument = pair.argument;
  const node = vec([Math.cos(nodeAngle), 0, Math.sin(nodeAngle)]);
  const transverse = vec([
    -Math.sin(nodeAngle) * Math.cos(inclination),
    Math.sin(inclination),
    Math.cos(nodeAngle) * Math.cos(inclination),
  ]);
  const normal = vec([
    -Math.sin(nodeAngle) * Math.sin(inclination),
    -Math.cos(inclination),
    Math.cos(nodeAngle) * Math.sin(inclination),
  ]);
  const major = vec([
    node[0] * Math.cos(argument) + transverse[0] * Math.sin(argument),
    transverse[1] * Math.sin(argument),
    node[2] * Math.cos(argument) + transverse[2] * Math.sin(argument),
  ]);
  const minor = vec([
    -node[0] * Math.sin(argument) + transverse[0] * Math.cos(argument),
    transverse[1] * Math.cos(argument),
    -node[2] * Math.sin(argument) + transverse[2] * Math.cos(argument),
  ]);
  const rotation = pair.apsidalRotation;
  const cosRotation = Math.cos(rotation);
  const sinRotation = Math.sin(rotation);
  const rotatedMinor = vec([
    minor[0] * cosRotation - normal[0] * sinRotation,
    minor[1] * cosRotation - normal[1] * sinRotation,
    minor[2] * cosRotation - normal[2] * sinRotation,
  ]);
  const rotatedNormal = vec([
    normal[0] * cosRotation + minor[0] * sinRotation,
    normal[1] * cosRotation + minor[1] * sinRotation,
    normal[2] * cosRotation + minor[2] * sinRotation,
  ]);
  return {
    node,
    transverse,
    normal: rotatedNormal,
    major,
    minor: rotatedMinor,
  };
}

export type StandardOrbitElements = Pick<
  ApsisPair,
  "argument" | "inclination" | "ascendingNode"
>;

/** Convert the displayed orientation to the three elements consumed by Kerr. */
export function standardOrbitElements(pair: ApsisPair): StandardOrbitElements {
  const basis = orbitBasis(pair);
  let normal = basis.normal;

  // The inclined solver follows the prograde branch. A plane has two normals,
  // so choose the one in the prograde hemisphere without changing its shape.
  if (normal[1] > 0) {
    normal = normal.map((value) => -value) as [number, number, number];
  }

  const inclination = Math.acos(Math.max(-1, Math.min(1, -normal[1])));
  if (inclination < 1e-10) {
    return {
      argument: normalizeAngle(Math.atan2(basis.major[2], basis.major[0])),
      inclination: 0,
      ascendingNode: 0,
    };
  }

  const ascendingNode = normalizeAngle(Math.atan2(-normal[0], normal[2]));
  const node: [number, number, number] = [
    Math.cos(ascendingNode),
    0,
    Math.sin(ascendingNode),
  ];
  const transverse: [number, number, number] = [
    -Math.sin(ascendingNode) * Math.cos(inclination),
    Math.sin(inclination),
    Math.cos(ascendingNode) * Math.cos(inclination),
  ];
  const dot = (
    left: [number, number, number],
    right: [number, number, number],
  ) => left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
  const argument = normalizeAngle(
    Math.atan2(dot(basis.major, transverse), dot(basis.major, node)),
  );
  return { argument, inclination, ascendingNode };
}

/** Eccentricity of the Newtonian ellipse through a pair of apsides. */
export function eccentricity({ periapsis, apoapsis }: ApsisPair): number {
  const sum = apoapsis + periapsis;
  return sum > 0 ? (apoapsis - periapsis) / sum : 0;
}

/** Semi-latus rectum of the Newtonian ellipse, in units of M. */
export function semiLatusRectum({ periapsis, apoapsis }: ApsisPair): number {
  const sum = apoapsis + periapsis;
  return sum > 0 ? (2 * apoapsis * periapsis) / sum : 0;
}

/**
 * Points on the Newtonian ellipse, in the shader's equatorial Cartesian frame
 * (`x = r cos φ`, `y = 0`, `z = r sin φ`), matching `Worldline.toCartesian`.
 *
 * The **apoapsis is placed at φ = 0** because that is where the integrator
 * launches the object — `initial_state` releases it at the outer turning point
 * with `x[3] = 0`. Putting the periapsis there instead (the usual convention
 * for `r = p / (1 + e cos φ)`) would draw a preview rotated half a turn from
 * the trajectory that follows, and the handles would jump on drop.
 */
export function newtonianEllipse(
  pair: ApsisPair,
  segments = 128,
): [number, number, number][] {
  const e = eccentricity(pair);
  const p = semiLatusRectum(pair);
  const points: [number, number, number][] = [];
  const { major, minor } = orbitBasis(pair);
  for (let i = 0; i <= segments; i++) {
    const phi = (i / segments) * Math.PI * 2;
    // r = p / (1 - e cos φ): apoapsis at φ = 0, periapsis at φ = π.
    const denominator = 1 - e * Math.cos(phi);
    if (denominator <= 1e-6) continue;
    const r = p / denominator;
    const alongMajor = r * Math.cos(phi);
    const alongMinor = r * Math.sin(phi);
    points.push(
      (
        [
          major[0] * alongMajor + minor[0] * alongMinor,
          major[1] * alongMajor + minor[1] * alongMinor,
          major[2] * alongMajor + minor[2] * alongMinor,
        ] as [number, number, number]
      ).map((v) => (Math.abs(v) < 1e-15 ? 0 : v)) as [number, number, number],
    );
  }
  return points;
}

/**
 * Where the two handles sit, in the same frame. Apoapsis at φ = 0, periapsis
 * at φ = π — the two ends of the ellipse's major axis.
 */
export function apsisHandlePositions(pair: ApsisPair): {
  apoapsis: [number, number, number];
  periapsis: [number, number, number];
} {
  const { major } = orbitBasis(pair);
  return {
    apoapsis: major.map((v) => v * pair.apoapsis) as [number, number, number],
    periapsis: major.map((v) => {
      const value = -v * pair.periapsis;
      return Math.abs(value) < 1e-15 ? 0 : value;
    }) as [number, number, number],
  };
}

/**
 * Drag limits, in M.
 *
 * The inner limit is *not* the ISCO or the separatrix: §6.3 is explicit that a
 * periapsis inside the separatrix must plunge rather than be prevented, and
 * dragging to the middle is how you ask for a radial free fall. The only real
 * floor is the horizon, and even that is allowed — a periapsis below it is a
 * capture, which is a thing the simulator should be able to show.
 */
export const APSIS_DRAG_LIMITS = { min: 0.2, max: 400 } as const;

/** Clamp a dragged radius into the range the panel can represent. */
export function clampApsis(r: number): number {
  if (!Number.isFinite(r)) return APSIS_DRAG_LIMITS.min;
  return Math.min(APSIS_DRAG_LIMITS.max, Math.max(APSIS_DRAG_LIMITS.min, r));
}

/** Minor-axis endpoints are centred on the ellipse, not on its focus. */
export function minorAxisHandlePositions(pair: ApsisPair): {
  a: [number, number, number];
  b: [number, number, number];
} {
  const { major, minor } = orbitBasis(pair);
  const centre = (pair.apoapsis - pair.periapsis) / 2;
  const semiMinor = Math.sqrt(pair.apoapsis * pair.periapsis);
  const point = (sign: number) =>
    major.map((v, i) => v * centre + sign * semiMinor * (minor[i] ?? 0)) as [
      number,
      number,
      number,
    ];
  return { a: point(1), b: point(-1) };
}
