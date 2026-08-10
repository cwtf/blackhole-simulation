import { SimulatorApp } from "@/components/fork/SimulatorApp";

/**
 * The simulator's root route.
 *
 * The app shell lives in `components/fork/SimulatorApp.tsx` so per-object routes at
 * `/{name}/` can render the same component with a real black hole
 * preselected. Nothing else changed in the move.
 *
 * No `initialObjectId` here on purpose: the bare route is the generic
 * simulator, which opens on the synthetic stellar-mass preset rather than
 * claiming to be any particular object.
 */
export default function Page() {
  return <SimulatorApp />;
}
