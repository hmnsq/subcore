# © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
# SPDX-License-Identifier: GPL-3.0-or-later
"""Project Chrono sample for the reference runner: two 1D shafts coupled by an ideal gear (ChShaftsGear) with
ratio -z1/z2 = -20/40, the first driven at a constant speed of 1 rad/s by a ChShaftsMotorSpeed against a fixed
shaft. Writes <out>/gear.csv (t, angle 1, angle 2, ratio). Usage: python chrono_gear.py <out>"""
import sys
from pathlib import Path
import pychrono as chrono

out = Path(sys.argv[1])
sys_ = chrono.ChSystemNSC()
ground = chrono.ChShaft(); ground.SetFixed(True); sys_.Add(ground)
s1 = chrono.ChShaft(); s1.SetInertia(0.01); sys_.Add(s1)
s2 = chrono.ChShaft(); s2.SetInertia(0.02); sys_.Add(s2)
gear = chrono.ChShaftsGear(); gear.Initialize(s1, s2); gear.SetTransmissionRatio(-20.0 / 40.0); sys_.Add(gear)
motor = chrono.ChShaftsMotorSpeed(); motor.Initialize(s1, ground)
motor.SetSpeedFunction(chrono.ChFunctionConst(1.0)); sys_.Add(motor)
h, steps = 1e-3, 10000
lines = ["# t theta1 theta2 theta2/theta1; Project Chrono " + str(getattr(chrono, "CHRONO_VERSION", "version not exposed"))]
worst = 0.0
for k in range(1, steps + 1):
    sys_.DoStepDynamics(h)
    if k % 100 == 0:
        t1, t2 = s1.GetPos(), s2.GetPos()
        ratio = t2 / t1 if t1 else float("nan")
        worst = max(worst, abs(ratio + 0.5))
        lines.append(f"{sys_.GetChTime():.16e} {t1:.16e} {t2:.16e} {ratio:.16e}")
(out / "gear.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"chrono gear pair: largest |ratio - (-0.5)| = {worst:.3e}")
