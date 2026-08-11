//! Spec §1.6: what happens when the interior ride does not reach the centre.
//!
//! The horizon handover releases the rider from rest at 1.02·r_+, which gives a
//! very low conserved energy — E ≈ 0.08 at a* = 0.9 against E ≈ 0.95 for a fall
//! from 20 M. For an equatorial geodesic with L_z = 0 the radial potential
//! factors as R(r) = r·f(r) with
//!
//! ```text
//!   f(r) = (E²−1) r³ + 2M r² + a²(E²−1) r + 2M a² E²
//! ```
//!
//! and f(0) = 2M a² E² > 0, so a spinning hole always has a barrier for a
//! zero-angular-momentum infaller. Above |a*| ≈ 0.5 that barrier sits outside
//! the renderer's 0.04 M cutoff, the object turns around, and heads back toward
//! the inner (Cauchy) horizon — which *ingoing* Kerr-Schild cannot represent an
//! outgoing crossing of, because p_r diverges as 4MrE/Δ there.
//!
//! Before this was handled, the integration ran into that coordinate
//! singularity: the stepper collapsed to its floor, force-accepted steps walked
//! the state onto the divergent p_r branch, and the buffer ended with r = −6.47,
//! u^μ ≈ 1e17, u·u = +2.8e35 and a static-fallback tetrad. The 1st-person camera
//! clamps proper time to the last sample, so that is exactly what it rendered —
//! a frozen, degenerate frame outside the hole.
//!
//! These tests pin the two things that matter: the run stops at the *physical*
//! turning point, and no sample the camera can reach is ever garbage.

use gravitas::metric::{Kerr, Metric};
use gravitas::physics::tetrad::{dot, tetrad_from_velocity};
use gravitas::physics::worldline::{
    integrate_worldline, DropSpec, Worldline, WorldlineEnd, WorldlineOptions,
};

const M: f64 = 1.0;
const CUTOFF: f64 = 0.04;

fn interior_options() -> WorldlineOptions {
    WorldlineOptions {
        inner_radius: CUTOFF * M,
        max_steps: 800_000,
        max_samples: 8_000,
        ..Default::default()
    }
}

/// The app's horizon handover: released from rest just outside r_+.
fn handover(spin: f64) -> (Kerr, Worldline) {
    let bh = Kerr::kerr_schild(M, spin);
    let r0 = 1.02 * bh.event_horizon();
    let w = integrate_worldline(&bh, DropSpec::RadialFall { r: r0 }, &interior_options());
    (bh, w)
}

fn f_of_r(r: f64, e: f64, a: f64) -> f64 {
    let e2 = e * e;
    (e2 - 1.0) * r * r * r + 2.0 * M * r * r + a * a * (e2 - 1.0) * r + 2.0 * M * a * a * e2
}

/// Outermost positive root of f, i.e. the turning point an infaller from
/// outside actually meets. `None` when the barrier never bites.
fn analytic_turning_point(e: f64, a: f64) -> Option<f64> {
    let mut root = None;
    let step = 1e-4;
    let mut r = step;
    let mut prev = f_of_r(r, e, a);
    while r < 3.0 {
        let next = r + step;
        let cur = f_of_r(next, e, a);
        if prev < 0.0 && cur >= 0.0 {
            let (mut lo, mut hi) = (r, next);
            for _ in 0..100 {
                let mid = 0.5 * (lo + hi);
                if f_of_r(mid, e, a) < 0.0 {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            root = Some(0.5 * (lo + hi));
        }
        prev = cur;
        r = next;
    }
    root.filter(|t| *t > CUTOFF * M)
}

#[test]
fn high_spin_handover_stops_at_the_analytic_turning_point() {
    for spin in [0.6, 0.7, 0.8, 0.9, 0.95, 0.99] {
        let (bh, w) = handover(spin);
        let turn = analytic_turning_point(w.energy, spin)
            .unwrap_or_else(|| panic!("spin {spin}: expected a barrier above the cutoff"));

        assert_eq!(
            w.end,
            WorldlineEnd::ReachedTurningPoint,
            "spin {spin}: ended {:?} instead of at the bounce",
            w.end
        );

        let last = w.samples.last().expect("samples");
        assert!(
            (last.r - turn).abs() < 2e-3,
            "spin {spin}: stopped at r = {:.6}, analytic turning point is {turn:.6}",
            last.r
        );
        // Strictly inside the horizon and strictly outside the cutoff: it
        // neither escaped nor arrived.
        assert!(
            last.r < bh.event_horizon() && last.r > CUTOFF * M,
            "spin {spin}: final r = {:.6} not between the cutoff and r_+",
            last.r
        );
        // And it really did get inside first.
        assert!(
            w.samples.iter().any(|s| s.r < bh.event_horizon()),
            "spin {spin}: never crossed the horizon"
        );
    }
}

#[test]
fn low_spin_handover_still_reaches_the_cutoff() {
    // Below the barrier threshold nothing changes: these must still arrive.
    for spin in [0.0, 0.2, 0.4, 0.5] {
        let (_, w) = handover(spin);
        assert_eq!(
            w.end,
            WorldlineEnd::ReachedInnerRadius,
            "spin {spin}: ended {:?} instead of at the cutoff",
            w.end
        );
        let last = w.samples.last().expect("samples");
        assert!(
            last.r > 0.0 && last.r <= CUTOFF * M,
            "spin {spin}: final r = {:.6} is not the cutoff",
            last.r
        );
    }
}

#[test]
fn a_fall_from_far_away_reaches_the_cutoff_at_every_spin() {
    // E ≈ 0.95 clears the barrier, so the handover's bounce must not have
    // introduced an early stop for the trajectory the panel actually drops.
    for spin in [0.0, 0.5, 0.9, 0.99, -0.9] {
        let bh = Kerr::kerr_schild(M, spin);
        let w = integrate_worldline(
            &bh,
            DropSpec::RadialFall { r: 20.0 * M },
            &interior_options(),
        );
        assert_eq!(
            w.end,
            WorldlineEnd::ReachedInnerRadius,
            "spin {spin}: ended {:?}",
            w.end
        );
        let last = w.samples.last().expect("samples");
        assert!(
            last.r > 0.0 && last.r <= CUTOFF * M,
            "spin {spin}: final r = {:.6}",
            last.r
        );
    }
}

/// The property the 1st-person camera actually depends on.
///
/// `sampleByProperTime` clamps to the last sample and hands its tetrad straight
/// to the renderer, so *every* stored sample has to be a real point on a
/// timelike worldline — not merely most of them.
#[test]
fn no_stored_sample_is_ever_garbage() {
    let mut spins: Vec<f64> = Vec::new();
    let mut s: f64 = -0.99;
    while s <= 0.99 {
        spins.push((s * 100.0).round() / 100.0);
        s += 0.07;
    }

    for spin in spins {
        let (bh, w) = handover(spin);
        assert!(!w.samples.is_empty(), "spin {spin}: no samples");

        for sample in &w.samples {
            assert!(
                sample.r.is_finite() && sample.r > 0.0,
                "spin {spin}: r = {} is not a radius",
                sample.r
            );
            assert!(
                sample.tau.is_finite() && sample.u.iter().all(|c| c.is_finite()),
                "spin {spin}: non-finite state at r = {:.6}",
                sample.r
            );

            // On the mass shell, to the tolerance the stored f64 supports.
            let norm = dot(&bh, sample.r, sample.theta, &sample.u, &sample.u);
            assert!(
                (norm + 1.0).abs() < 1e-6,
                "spin {spin}: u·u = {norm:.6e} at r = {:.6}",
                sample.r
            );

            // And a frame the camera can use, rather than the static fallback
            // that a spacelike u collapses to.
            let frame = tetrad_from_velocity(&bh, sample.r, sample.theta, &sample.u);
            assert_ne!(
                frame.e[0],
                [1.0, 0.0, 0.0, 0.0],
                "spin {spin}: static-fallback tetrad at r = {:.6}",
                sample.r
            );
            let err = frame.orthonormality_error(&bh, sample.r, sample.theta);
            assert!(
                err < 1e-6,
                "spin {spin}: orthonormality error {err:.3e} at r = {:.6}",
                sample.r
            );
        }
    }
}

/// Proper time must keep advancing right up to the last sample.
///
/// This is the freeze, stated as a property: when the stepper stalled, hundreds
/// of samples shared one value of τ, so `sampleByProperTime` returned the same
/// point forever however far the playback clock ran.
#[test]
fn proper_time_advances_all_the_way_to_the_last_sample() {
    for spin in [0.0, 0.5, 0.7, 0.9, 0.99] {
        let (_, w) = handover(spin);
        let n = w.samples.len();
        assert!(n > 20, "spin {spin}: only {n} samples");

        // No run of stalled samples at the end.
        let total = w.proper_time.max(w.samples[n - 1].tau);
        let stalled = w
            .samples
            .iter()
            .filter(|s| (total - s.tau).abs() < 1e-9)
            .count();
        assert!(
            stalled <= 2,
            "spin {spin}: {stalled} samples pinned at the final tau {total:.9}"
        );

        // And tau is strictly increasing across every adjacent pair.
        for pair in w.samples.windows(2) {
            assert!(
                pair[1].tau > pair[0].tau,
                "spin {spin}: tau did not advance at r = {:.6} (tau {:.9})",
                pair[0].r,
                pair[0].tau
            );
        }
    }
}

#[test]
fn bound_orbits_are_not_cut_short_by_the_turning_point_test() {
    // Eccentric and apsides orbits turn around on every revolution, outside the
    // horizon. Gating the test on r < r_+ is what keeps them intact.
    let bh = Kerr::kerr_schild(M, 0.5);
    for drop in [
        DropSpec::Eccentric {
            r: 20.0,
            tangential_fraction: 0.9,
        },
        DropSpec::FromApsides {
            r_apo: 20.0,
            r_peri: 10.0,
            argument: 0.0,
            inclination: 0.0,
            ascending_node: 0.0,
        },
    ] {
        let w = integrate_worldline(&bh, drop, &interior_options());
        assert_ne!(
            w.end,
            WorldlineEnd::ReachedTurningPoint,
            "a bound orbit was terminated at its periapsis: {drop:?}"
        );
        assert!(
            w.min_radius() > bh.event_horizon(),
            "{drop:?} was expected to stay outside the horizon, reached {:.6}",
            w.min_radius()
        );
        // It should have gone round several times, not stopped at the first
        // periapsis.
        assert!(
            w.periapsis_indices().len() >= 2,
            "{drop:?} recorded only {} periapsis passages",
            w.periapsis_indices().len()
        );
    }
}
