# Forester

A tool to trace areas (forests, water bodies, buildings, ...) from classified clouds of points.

## Requiremens

- Deno
- PDAL
- WhiteboxTools
- GDAL
- GRASS GIS
- jq

## Tools

### Preprocessing

Create `./lazfiles.meta.jsonl`:

```bash
find /home/martin/14TB -name '*_jtsk03_bpv.laz' | parallel "echo {}; pdal info --summary {} | jq -c" > lazfiles.meta.jsonl
```

Create preprocessed files:

```bash
deno run --allow-read --allow-write --allow-run preprocess.ts
```

Merge preprodessed files.

### The server

```bash
FORESTER_DATA_DIR_PATH=/path/to/data/from/preprocessing FORESTER_WORK_DIR=./work FORESTER_PORT=8085 deno run --allow-read --allow-write --allow-net --allow-run server.ts
```
