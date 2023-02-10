import { readableStreamFromReader } from "https://deno.land/std@0.171.0/streams/readable_stream_from_reader.ts";
import { writableStreamFromWriter } from "https://deno.land/std@0.171.0/streams/writable_stream_from_writer.ts";
import { assureSuccess } from "./util.ts";

console.log("Majority filtering");

await assureSuccess(
  Deno.run({
    cmd: [
      "whitebox_tools",
      "-r=MajorityFilter",
      "-v",
      "--wd=.",
      "-i=work/binary.tif",
      "-o=work/mf.tif",
      "--filter=19",
    ],
  })
);

console.log("Polygonizing");

await assureSuccess(
  Deno.run({
    cmd: ["gdal_polygonize.py", "work/mf.tif", "work/out.shp"],
  })
);

console.log("Setting SRS");

await assureSuccess(
  Deno.run({
    cmd: [
      "ogr2ogr",
      "-overwrite",
      "-a_srs",
      "epsg:8353",
      "-where",
      '"DN" = 1',
      "work/out8353.shp",
      "work/out.shp",
    ],
  })
);

console.log("Generalizing");

await assureSuccess(
  Deno.run({
    cmd: [
      "grass",
      "--tmp-location",
      "EPSG:8353",
      "--exec",
      "sh",
      "grass_batch_job.sh",
    ],
  })
);

console.log("Converting to geojson");

await assureSuccess(
  Deno.run({
    cmd: [
      "ogr2ogr",
      "-overwrite",
      "-t_srs",
      "epsg:4326",
      "work/out.geojson",
      "work/generalized.gpkg",
    ],
  })
);

console.log("Adding tags");

const p = Deno.run({
  cmd: [
    "jq",
    '.features[].properties = {natural: "wood", source: "ÚGKK SR LLS"}',
    "work/out.geojson",
  ],
  stdout: "piped",
});

readableStreamFromReader(p.stdout).pipeTo(
  writableStreamFromWriter(
    await Deno.open("./work/result.geojson", {
      read: true,
      write: true,
      create: true,
    })
  )
);

await assureSuccess(p);
