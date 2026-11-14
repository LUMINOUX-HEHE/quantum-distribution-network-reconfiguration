# Optional service artifacts

The platform is a single Node/Next.js deployment; nothing here is required to run it.
These artifacts satisfy deployments that standardise on Python tooling and let the
quantum formulation be cross-checked outside the application runtime.

| File | Purpose |
|---|---|
| `api/main.py` | FastAPI gateway exposing the same resources with OpenAPI docs at `/docs`; forwards the session cookie upstream so RBAC and audit still apply. |
| `qaoa_aer.py` | Runs the exact QAOA circuit exported by `GET /api/v1/qaoa/circuit` on Qiskit Aer and reports measured bitstrings. |

```bash
pip install fastapi uvicorn httpx qiskit qiskit-aer
ustream=...  # optional
uvicorn services.api.main:app --port 8000

# export a circuit from the running app, then cross-check it on Aer
curl -s -b cookies.txt 'http://localhost:3000/api/v1/qaoa/circuit?networkId=1' | jq -r .qasm > /tmp/circuit.qasm
python services/qaoa_aer.py --qasm /tmp/circuit.qasm --shots 4096 --json
```

The in-app statevector simulator and `qaoa_aer.py` consume the same Ising
decomposition (single-qubit Z rotations, ZZ couplings, Rx mixer), so the two
implementations can be compared shot-for-shot.
