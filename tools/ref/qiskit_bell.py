# © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
# SPDX-License-Identifier: GPL-3.0-or-later
"""Qiskit Aer sample for the reference runner: spec/circuits/bell.qasm (OpenQASM 3), state vector and 100000
seeded shots. Writes <out>/statevector.csv and <out>/counts.json. Usage: python qiskit_bell.py <qasm> <out>"""
import json, sys
from pathlib import Path
import qiskit, qiskit_aer
from qiskit import qasm3, transpile
from qiskit_aer import AerSimulator

src, out = Path(sys.argv[1]), Path(sys.argv[2])
qc = qasm3.loads(src.read_text(encoding="utf-8"))
nm = qc.remove_final_measurements(inplace=False)
sv = AerSimulator(method="statevector")
c2 = nm.copy(); c2.save_statevector()
state = sv.run(transpile(c2, sv)).result().get_statevector()
lines = ["# basis (Qiskit little-endian: qubit 0 is the rightmost bit), real, imaginary"]
for i, a in enumerate(state.data):
    lines.append(f"{i:0{qc.num_qubits}b} {a.real:.16e} {a.imag:.16e}")
(out / "statevector.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")
sim = AerSimulator()
counts = sim.run(transpile(qc, sim), shots=100000, seed_simulator=20261104).result().get_counts()
(out / "counts.json").write_text(json.dumps({"shots": 100000, "seed_simulator": 20261104, "counts": dict(sorted(counts.items()))}, indent=1) + "\n", encoding="utf-8")
print(f"qiskit {qiskit.__version__}, qiskit-aer {qiskit_aer.__version__}: counts {dict(sorted(counts.items()))}")
