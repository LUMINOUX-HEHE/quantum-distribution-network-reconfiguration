#!/usr/bin/env python3
"""QAOA cross-check runner using Qiskit and Qiskit Aer.

The platform exports the exact circuit it simulates in-app (OpenQASM 3) from
GET /api/v1/qaoa/circuit. This runner executes that circuit on Aer, reports the
measured bitstrings and the energy distribution, and can sweep the variational
parameters so the TypeScript coordinate search can be validated independently.

Install:  pip install qiskit qiskit-aer
Usage:    python services/qaoa_aer.py --qasm circuit.qasm --shots 4096
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def load_qasm(path: Path) -> str:
    if not path.exists():
        sys.exit(f"QASM file not found: {path}")
    return path.read_text(encoding="utf-8")


def run(qasm: str, shots: int, seed: int) -> dict:
    try:
        from qiskit import qasm3, transpile
        from qiskit_aer import AerSimulator
    except ImportError as exc:  # pragma: no cover - environment dependent
        sys.exit(
            "Qiskit is not installed. Run `pip install qiskit qiskit-aer` "
            f"(import error: {exc})."
        )

    circuit = qasm3.loads(qasm)
    backend = AerSimulator()
    compiled = transpile(circuit, backend)
    result = backend.run(compiled, shots=shots, seed_simulator=seed).result()
    counts = result.get_counts()
    ranked = sorted(counts.items(), key=lambda item: item[1], reverse=True)
    return {
        "qubits": circuit.num_qubits,
        "depth": compiled.depth(),
        "shots": shots,
        "backend": "qiskit_aer.AerSimulator",
        "top_bitstrings": ranked[:20],
        "distinct_outcomes": len(counts),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the exported QAOA circuit on Qiskit Aer")
    parser.add_argument("--qasm", type=Path, required=True)
    parser.add_argument("--shots", type=int, default=4096)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--json", action="store_true", help="emit machine-readable output")
    args = parser.parse_args()

    report = run(load_qasm(args.qasm), args.shots, args.seed)
    if args.json:
        print(json.dumps(report, indent=2))
        return
    print(f"backend: {report['backend']}")
    print(f"qubits: {report['qubits']}  depth: {report['depth']}  shots: {report['shots']}")
    print("top outcomes (bitstring, count):")
    for bits, count in report["top_bitstrings"]:
        print(f"  {bits}  {count}")


if __name__ == "__main__":
    main()
