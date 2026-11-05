# © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
# SPDX-License-Identifier: GPL-3.0-or-later
"""QuTiP sample for the reference runner: the harmonic oscillator as a truncated oscillator Hamiltonian
H = omega (a+ a + 1/2) (Guidelines 10). A coherent state with alpha = 1/sqrt(2) (so <x>(0) = 1 with
x = (a + a+)/sqrt(2)) evolves; <x>(t) follows the classical cos(omega t). Writes <out>/expect_x.csv with the
classical value and the difference. Usage: python qutip_oscillator.py <out>"""
import sys
from pathlib import Path
import numpy as np
import qutip

out = Path(sys.argv[1])
N, omega = 30, 2.0
a = qutip.destroy(N)
H = omega * (a.dag() * a + 0.5)
x = (a + a.dag()) / np.sqrt(2)
psi0 = qutip.coherent(N, 1 / np.sqrt(2))
times = np.linspace(0.0, 10.0, 201)
r = qutip.sesolve(H, psi0, times, e_ops=[x], options={"atol": 1e-12, "rtol": 1e-10})
ex = np.real(r.expect[0])
cl = np.cos(omega * times)
lines = ["# t <x> cos(omega t) difference; N = 30, omega = 2, alpha = 1/sqrt(2)"]
lines += [f"{t:.16e} {e:.16e} {c:.16e} {e - c:.3e}" for t, e, c in zip(times, ex, cl)]
(out / "expect_x.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"qutip {qutip.__version__}: max |<x> - cos(omega t)| = {np.max(np.abs(ex - cl)):.3e}")
