# Copied from nza-twin-lab @ 4da46dc (services/roof/Dockerfile) on 2026-10-01. Diverged: no.
#
# ⚠ STILL UNVERIFIED — see docs/audit/20/roof-service.md §4. It could not be built in Brief 20 P2
# because this machine has no Docker and no WSL (checked: docker, docker-compose, podman all absent;
# `wsl -l -v` reports the subsystem is not installed). The service was instead verified **natively**
# on this machine, end to end, against the conda env — numbers in that audit file. The content below
# is deliberately UNCHANGED from upstream rather than "improved" blind: editing a Dockerfile nobody
# can build only moves the risk. One thing did change in its favour — `environment.yml` is trimmed
# of the Route A toolchain (see its header), so this image is smaller and builds faster than the
# upstream one would.
#
# Verification procedure for whoever first deploys it, in order (§4 of the audit has the expected
# output of each):
#   1. docker compose build roof
#   2. docker compose up -d roof
#   3. curl localhost:8008/health         → {"ok":true,"cgal":"CGAL 6.2.1","skel_ms":…}
#   4. the two POST checks in §2 of the audit, which must match the native numbers recorded there
#   5. docker compose exec roof /opt/conda/envs/roof/bin/pytest -q    → 68 passed
# Then change this header to say verified, with the date, the platform and the CGAL version.
#
# CGAL is GPL-3. It lives in this image only, reached over HTTP by decodED's Express, and never
# reaches a browser or public/. docs/dependencies.md §0.
#
# Brief 56 Part 2 (27 Oct 2026): roofer (3DBAG, GPL-3) joins CGAL in this image — the same licence
# boundary (D4). It is installed from its pinned release (v1.0.0, the version the spike built from
# source; the Linux x86_64 tarball, sha256 checked), not compiled here: a Conan build of roofer takes
# the better part of an hour in CI and gives the same binary. The job's Python (services/roof/roofer/)
# runs it as a subprocess and keeps the EA tiles under /srv/roof/cache — mount a disk there on the host
# (render.yaml) or the cache dies with the container. PROJ_NETWORK=ON lets pyproj fetch the OSTN15
# grid, so decodED's footprints land on the EA cloud's datum (job.py records which operation it used).
FROM condaforge/miniforge3:latest
WORKDIR /srv/roof
COPY environment.yml .
RUN conda env create -f environment.yml && conda clean -afy

ARG ROOFER_VERSION=1.0.0
ARG ROOFER_SHA256=85834b289467b0e583e2b9c59a725c97ef39dc03c0c0a12417a8a0666e1aa0a1
# (the miniforge image has no curl; the env's Python fetches, checks the sha256 and unpacks)
RUN /opt/conda/envs/roof/bin/python - "$ROOFER_VERSION" "$ROOFER_SHA256" <<'PY' \
    && /opt/roofer/bin/roofer --version
import hashlib, io, os, sys, tarfile, time, urllib.error, urllib.request
version, want = sys.argv[1], sys.argv[2]
url = f"https://github.com/3DBAG/roofer/releases/download/v{version}/roofer-linux-x86_64-v{version}.tar.gz"
for attempt in range(1, 7):  # GitHub's release download sometimes answers 5xx for a minute or two
    try:
        data = urllib.request.urlopen(url, timeout=600).read()
        break
    except (urllib.error.URLError, TimeoutError) as e:
        if attempt == 6 or (isinstance(e, urllib.error.HTTPError) and e.code < 500):
            raise
        print(f"roofer download try {attempt} failed ({e}); trying again in {10 * attempt} s", flush=True)
        time.sleep(10 * attempt)
got = hashlib.sha256(data).hexdigest()
if got != want:
    sys.exit(f"roofer tarball sha256 {got} is not the pinned {want}")
with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
    tar.extractall("/opt/roofer", filter="fully_trusted")
os.chmod("/opt/roofer/bin/roofer", 0o755)  # the tarball's entry carries no execute bit
print(f"roofer v{version}: {len(data) / 1e6:.1f} MB, sha256 ok, unpacked to /opt/roofer")
PY
# roofer's own GDAL/PROJ data go to the roofer SUBPROCESS only (job.py): a global PROJ_DATA would point the
# conda env's pyproj at roofer's proj.db, a different PROJ build.
ENV PATH=/opt/roofer/bin:$PATH \
    ROOFER_GDAL_DATA=/opt/roofer/share/gdal \
    ROOFER_PROJ_DATA=/opt/roofer/share/proj \
    PROJ_NETWORK=ON \
    ROOFER_CACHE_DIR=/srv/roof/cache
RUN mkdir -p /srv/roof/cache

COPY roof ./roof
COPY roofer ./roofer
COPY skel ./skel
ENV CONDA_PREFIX=/opt/conda/envs/roof
RUN /opt/conda/envs/roof/bin/python -c "from roof import skel; skel.build()"
EXPOSE 8008
CMD ["/opt/conda/envs/roof/bin/uvicorn", "roof.app:app", "--host", "0.0.0.0", "--port", "8008"]
