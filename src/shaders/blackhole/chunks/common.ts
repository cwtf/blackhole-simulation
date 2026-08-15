import { PHYSICS_CONSTANTS } from "@/configs/physics.config";

export const COMMON_CHUNK = `
  precision highp float;
  
  // Fragment output (WebGL2)
  out vec4 fragColor;
  
  // === UNIFORMS ===
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_mass;
  uniform float u_spin;
  uniform float u_disk_density;
  uniform float u_disk_temp;
  uniform vec2 u_mouse;
  uniform float u_zoom;
  uniform float u_lensing_strength;
  uniform float u_frame_dragging_strength;
  uniform float u_disk_size;
  uniform float u_disk_scale_height;
  uniform int u_maxRaySteps;
  uniform sampler2D u_noiseTex;
  uniform sampler2D u_blueNoiseTex;
  uniform sampler2D u_spectrumLUT;
  uniform float u_debug; // Debug mode toggle

  uniform float u_show_redshift; // Toggle for gravitational redshift overlay
  uniform float u_show_kerr_shadow; // Toggle for Kerr shadow guide
  uniform vec2 u_shadowShift; // Analytical Shadow Extents (min_alpha, max_alpha)
  uniform vec2 u_shadowCurve[64]; // Analytic Critical Curve (64 points)
  uniform float u_shadowCount;    // Actual number of valid points in the curve

  
  // High-Precision Camera State (SAB Synced)
  uniform vec3 u_camPos;
  uniform vec4 u_camQuat;

  // 1st-person camera riding the dropped object (spec §1.6).
  //
  // The four legs of the observer's orthonormal frame, resolved into this
  // shader's Cartesian axes on the CPU: .xyz is the spatial part, .w is the
  // contravariant time component e_(a)^t. Free-look rotates the local look
  // direction before it is lifted through these complete four-dimensional
  // legs, preserving orthonormality and the aberration pattern.
  //
  // Rendering traces arriving light toward its source with the past-directed
  // ray q = -e0 + n.x*e1 + n.y*e2 + n.z*e3. Aberration and the Doppler shift
  // are consequences of that sum, never applied separately.
  uniform float u_fp_enabled;
  uniform vec3 u_fp_pos;
  uniform vec4 u_fp_e0;
  uniform vec4 u_fp_e1;
  uniform vec4 u_fp_e2;
  uniform vec4 u_fp_e3;
  uniform vec4 u_fp_look;

  // The same four legs with their time index LOWERED: (e_a)_t, packed as
  // (e0, e1, e2, e3). Computed on the CPU by physics/first-person.ts, which is
  // the only place that knows which chart the worldline was integrated in.
  //
  // Contracting these against the look direction gives the arriving photon's
  // conserved Killing energy E = -p_t, and inside the horizon the SIGN of that
  // number is the whole causal structure: E > 0 means the photon fell in from
  // the outside universe, E < 0 means it can only have come through the past
  // horizon and must render black. E is conserved, so one test at the observer
  // settles the entire ray without marching it.
  //
  // The contravariant e_a^t in the .w slots above cannot answer this. It is
  // off by the lapse, which changes sign at the horizon, and in Kerr-Schild it
  // misses the g_tr and g_tphi terms outright.
  uniform vec4 u_fp_killing;

  // The other two Killing contractions, same packing: (e_a)_theta, and
  // (e_a)_phi already divided by sin(theta) on the CPU so the shader can add
  // their squares directly into L^2 without carrying the angle.
  //
  // With E these give the impact parameter b = L/E, which is what decides
  // whether an interior ray traced backwards clears the potential barrier at
  // r = 3M and reaches the sky. Exact at a = 0; at nonzero spin the true
  // criterion needs Carter's constant and the D-shaped critical curve, the
  // same approximation the geodesic marcher in metric.ts already documents.
  uniform vec4 u_fp_amom_theta;
  uniform vec4 u_fp_amom_phi;

  // The rider's own suit, drawn in the frame's local coordinates so looking
  // down shows the body it is attached to. 0 hides it. Free-look turns the
  // head, not the torso, so the suit stays put while the view swings over it.
  uniform float u_fp_body;

  // Tidal deformation of that suit: (transverse, radial) scale factors, both 1
  // while the body is still holding itself together.
  //
  // The closed-form geodesic-deviation solution from physics/tidal.ts, not a
  // material model -- past the failure load the pieces stop interacting and each
  // follows its own geodesic, which is exactly solvable. This is the only place
  // the mass preset changes a pixel: whether a rider is intact at a given r/r_s
  // is a question about M, so the render is mass-invariant and the *rider* is
  // not.
  uniform vec2 u_fp_strain;

  // The real Milky Way panorama (spec §6.2). u_sky_enabled is
  // 0 until the JPEG has been decoded and uploaded, and stays 0 if it fails --
  // the procedural starfield is then the fallback, so the sky is never a void.
  //
  // The basis vectors are the galactic frame's axes (centre / north pole /
  // right-handed third) expressed in scene coordinates. Passing three vec3s
  // rather than a mat3 keeps UniformBatcher, an upstream file, untouched.
  uniform sampler2D u_skyTex;
  uniform float u_sky_enabled;
  uniform float u_sky_intensity;
  uniform vec3 u_sky_basis_x;
  uniform vec3 u_sky_basis_y;
  uniform vec3 u_sky_basis_z;

  // === CONSTANTS ===
#define PI 3.14159265359
#define MAX_DIST ${PHYSICS_CONSTANTS.rayMarching.maxDistance.toFixed(1)}
  // Spec §6.1: radius beyond which an outward-bound ray is
  // treated as escaped and its current direction taken as the sky direction.
  // The neglected remaining deflection goes as ~2*r_s*b/r^2, which at this
  // radius is well under a pixel for any impact parameter that still has the
  // hole in frame.
#define ESCAPE_RADIUS ${PHYSICS_CONSTANTS.rayMarching.escapeRadius.toFixed(1)}
  // How hard the 1st-person sky's g^4 boost is compressed. Exposure, not
  // physics: the ordering of brightnesses is fixed by Liouville, the level
  // that ordering is displayed at is a choice. See the note at the use site.
#define FP_TONE_KNEE 100.0
#define MIN_STEP ${PHYSICS_CONSTANTS.rayMarching.minStep.toFixed(2)}
#define MAX_STEP ${PHYSICS_CONSTANTS.rayMarching.maxStep.toFixed(1)}

  // === HELPER FUNCTIONS ===
  mat2 rot(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, -s, s, c);
  }

  // ACES Tone Mapping (Narkowicz 2014)
  vec3 aces_tone_mapping(vec3 color) {
    float A = 2.51;
    float B = 0.03;
    float C = 2.43;
    float D = 0.59;
    float E = 0.14;
    return clamp((color * (A * color + B)) / (color * (C * color + D) + E), 0.0, 1.0);
  }


    /**
     * Analytic Shadow Boundary check.
     * Uses the Critical Curve coefficients from Rust to determine if a ray
     * hit the event horizon with infinite sub-pixel precision.
     */
    bool is_shadow(vec2 impactParams, vec2 criticalCurve) {
        // Simple elliptical approximation for now, 
        // will be upgraded to full parametric in Phase 3.
        float dist = length(impactParams / criticalCurve);
        return dist < 1.0;
    }

  // Quaternion Rotation (Phase 5.2)
  vec3 qrot(vec4 q, vec3 v) {
    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
  }
`;
