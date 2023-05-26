import * as path from "https://deno.land/std@0.178.0/path/mod.ts";
import { format } from "https://deno.land/std@0.178.0/fmt/duration.ts";

export type Meta = {
  filename: string;
  summary: {
    bounds: {
      minx: number;
      miny: number;
      maxx: number;
      maxy: number;
    };
  };
};

export type BBox = [number, number, number, number];

export async function getMetas() {
  return (await Deno.readTextFile("./lazfiles_all.meta.jsonl"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

export function getFiles(bbox: BBox, metas: Meta[]) {
  const files: string[] = metas
    .filter((meta) => {
      const { minx, miny, maxx, maxy } = meta.summary.bounds;

      return (
        ((bbox[2] > minx && bbox[2] < maxx) ||
          (bbox[0] > minx && bbox[0] < maxx) ||
          (bbox[0] <= minx && bbox[2] >= maxx)) &&
        ((bbox[3] > miny && bbox[3] < maxy) ||
          (bbox[1] > miny && bbox[1] < maxy) ||
          (bbox[1] <= miny && bbox[3] >= maxy))
      );
    })
    .map((meta) => meta.filename);

  return files;
}

export async function filter(
  index: number,
  workdir: string,
  files: string[],
  bbox: BBox,
  limits: string | null = "Classification[3:9]"
) {
  console.log(`Filtering ${index}`);

  const t = Date.now();

  await Promise.all(
    files.map(async (file) => {
      const p = new Deno.Command("/home/martin/fm/PDAL/build/bin/pdal", {
        args: ["pipeline", "-s"],
        stdin: "piped",
      }).spawn();

      const pipeline = [
        {
          override_srs: "EPSG:8353",
          filename: path.resolve("/home/martin/14TB", file),
        },
        limits && {
          type: "filters.range",
          limits,
        },
        {
          type: "filters.crop",
          bounds: `([${bbox[0]},${bbox[2]}],[${bbox[1]},${bbox[3]}])`,
        },
        workdir + "/" + path.basename(file),
      ].filter((a) => a);

      const writer = p.stdin.getWriter();

      await writer.write(new TextEncoder().encode(JSON.stringify(pipeline)));

      await writer.close();

      const commandOutput = await p.output();

      if (!commandOutput.success) {
        throw new Error("pdal failed: " + commandOutput.code);
      }
    })
  );

  console.log(
    `Done filtering ${index} in ${format(Date.now() - t, { ignoreZero: true })}`
  );
}

export async function render(
  index: number,
  workdir: string,
  files: string[],
  classifications: number[],
  _bbox: BBox
) {
  console.log(`Rendering ${index}`);

  const t = Date.now();

  const p = new Deno.Command("/home/martin/fm/PDAL/build/bin/pdal", {
    args: ["pipeline", "-s"],
    stdin: "piped",
  }).spawn();

  const pipeline = [
    ...files.map((file) => workdir + "/" + path.basename(file)),
    ...classifications.map((c) => ({
      type: "writers.gdal",
      resolution: 0.5,
      filename: workdir + `/binary_${c}.tif`,
      gdalopts: "COMPRESS=DEFLATE,PREDICTOR=2,ZLEVEL=5",
      output_type: "count",
      data_type: "uint16",
      where: `(Classification == ${c})`,
      // TODO - together with *TAP
      // origin_x: bbox[0],
      // origin_y: bbox[1],
      // width: bbox[2] - bbox[0],
      // height: bbox[3] - bbox[1],
    })),
  ];

  const writer = p.stdin.getWriter();

  await writer.write(new TextEncoder().encode(JSON.stringify(pipeline)));

  await writer.close();

  const commandOutput = await p.output();

  if (!commandOutput.success) {
    throw new Error("pdal failed: " + commandOutput.code);
  }

  console.log(
    `Done rendering ${index} in ${format(Date.now() - t, { ignoreZero: true })}`
  );
}
