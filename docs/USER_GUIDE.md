# User guide

1. **Sign in** with an engineer or admin account (demo credentials are listed on the sign-in page).
2. **Review the feeder** under Networks → open a network to inspect the topology, fundamental loops, branch data and the initial AC evaluation.
3. **Run an optimisation**: New run → pick feeder and solver → optionally set penalty weight, refinement passes, DER penetration, limits, baselines, seed and timeout → submit.
4. **Watch progress**: the run page streams stages (preprocess → QUBO → solve → refinement → baselines → validate) and structured logs.
5. **Read the recommendation**: headline loss reduction, gap to reference, minimum voltage, peak loading, side-by-side topology with changed switches highlighted, the ordered switching plan and the top-k candidate table.
6. **Compare methods** on the Benchmarks page; run a suite and inspect solver vs baseline losses, feasibility, gap and scaling charts.
7. **Stress the network** on the Resilience page: choose a line or switch fault, add critical buses, or run a full N-1 scan; every restoration is validated with AC power flow.
8. **Plan for renewables** on the Scenarios page: sweep weather, season, cloud, wind, load and variability across the horizon; compare curtailment and worst-case voltage against the latest recommendation.
9. **Export**: CSV or JSON from the run page, or a printable PDF summary.
10. **Audit and administer**: admins can change defaults and review the audit trail in Settings.
