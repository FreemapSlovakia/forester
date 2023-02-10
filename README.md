# Forester

A tool to trace forests from classified (4, 5) clouds of points.

## Requiremens

- Deno
- PDAL
- LAStools (just for merging and can be replaced by PDAL which on the other hand takes more RAM)
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

deno run --allow-read --allow-net --allow-run server.ts
