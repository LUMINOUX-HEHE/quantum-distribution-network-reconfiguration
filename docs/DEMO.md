# Demonstration script

## Scenario A — benchmark (≈2 minutes)

1. Overview → point out the pipeline strip and the four solver adapters.
2. Benchmarks → *Run comparison suite* → inspect the loss-by-method chart and the suite table (33/69/119-bus).
3. Open the IEEE 33-bus run → before/after topology with changed switches highlighted, switching plan, voltage profile and the top-k table showing repaired vs rejected samples.

## Scenario B — resilience (≈2 minutes)

1. Resilience → N-1 scan on the 33-bus feeder with critical buses 24, 25, 30.
2. Show remaining-interrupted count, average restored load and critical load at risk.
3. Switch the study to a single line failure (branch 8) and show the transfer action and AC validation of the restored state.

## Scenario C — renewables (≈2 minutes)

1. Scenarios → storm weather, 20% cloud, 12 m/s wind, 1.15× load, 12% variability, 24 h horizon.
2. Evaluate → hourly solar/wind availability with loss curves for current vs recommended configuration.
3. Read the curtailment and worst-case voltage columns; save the scenario to the library.

## Scenario D — governance (≈1 minute)

1. Settings → audit trail (admin only), solver availability without secrets, engineering defaults.
2. Program status → the 154-item checklist with per-item evidence.
3. Documentation → architecture, formulation, QUBO and API chapters.

A recording is not stored in the repository; this script is the reproducible substitute.
