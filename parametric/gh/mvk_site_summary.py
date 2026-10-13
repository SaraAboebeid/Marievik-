#! python3
"""MVK Site summary - collects the 'model' output of every building component."""
import json
rows = []
items = []
for m in (models or []):
    try:
        m = json.loads(str(m)) if not isinstance(m, dict) else m
        if "summary" in m:
            items.append(m)
    except Exception:
        pass
items.sort(key=lambda m: m["id"])
head = "%-4s %-34s %3s %-16s %-11s %8s %8s %8s %7s" % ("id", "name", "fl", "use (upper)", "ground", "GFA m2", "MSEK", "t CO2e", "kg/m2")
lines = [head, "-" * len(head)]
T = {"gfa": 0.0, "cost": 0.0, "gwp": 0.0}
for m in items:
    t = m["summary"]["total"]
    lines.append("%-4s %-34s %3d %-16s %-11s %8.0f %8.1f %8.0f %7.1f" % (
        m["id"], m["name"][:34], m["floors"], m["use"][:16], m["ground_use"][:11], m["gfa_m2"],
        t["cost_sek"] / 1e6, t["gwp_kgco2e"] / 1e3, t["gwp_kgco2e"] / m["gfa_m2"] if m["gfa_m2"] else 0))
    rows.append("%s,%s,%d,%s,%s,%.0f,%.0f,%.0f" % (m["id"], m["name"], m["floors"], m["use"], m["ground_use"],
                                                  m["gfa_m2"], t["cost_sek"], t["gwp_kgco2e"]))
    T["gfa"] += m["gfa_m2"]; T["cost"] += t["cost_sek"]; T["gwp"] += t["gwp_kgco2e"]
lines.append("-" * len(head))
lines.append("%-4s %-34s %3s %-16s %-11s %8.0f %8.1f %8.0f %7.1f" % ("", "SITE TOTAL (%d buildings)" % len(items), "", "", "",
             T["gfa"], T["cost"] / 1e6, T["gwp"] / 1e3, T["gwp"] / T["gfa"] if T["gfa"] else 0))
lines.append("New fit-out only (A1-A5, existing shells retained). Prices: Marievik+ catalogue (placeholder values).")
summary = "\n".join(lines)
table = rows
