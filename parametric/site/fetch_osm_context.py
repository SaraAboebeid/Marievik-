#! python3
# Download the full OpenStreetMap data (nodes, ways, relations) around Marievik for the urban context:
# streets, footpaths, the quay, water, greens, trees, railway. Saved raw next to this script.
# OpenStreetMap data (c) OpenStreetMap contributors, ODbL.
import os, urllib.request, json, time
HERE = r"C:\Users\saraabo\Desktop\Marievik+\parametric\site"
BOXES = {"north": (18.0160, 59.3090, 18.0440, 59.3160), "south": (18.0160, 59.3020, 18.0440, 59.3090)}
for name, (w, s, e, n) in BOXES.items():
    url = "https://api.openstreetmap.org/api/0.6/map.json?bbox=%.4f,%.4f,%.4f,%.4f" % (w, s, e, n)
    req = urllib.request.Request(url, headers={"User-Agent": "Marievik-research/1.0 (Chalmers)"})
    data = urllib.request.urlopen(req, timeout=120).read()
    out = os.path.join(HERE, "osm_context_%s.json" % name)
    with open(out, "wb") as f:
        f.write(data)
    print(name, len(data), "bytes ->", out, len(json.loads(data)["elements"]), "elements")
    time.sleep(2)
