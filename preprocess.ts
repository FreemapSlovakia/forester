import * as path from "https://deno.land/std@0.171.0/path/mod.ts";
import PQueue from "https://esm.sh/p-queue@7.3.0/";
import { assureSuccess } from "./util.ts";

type Meta = {
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

type BBox = [number, number, number, number];

const metas: Meta[] = (await Deno.readTextFile("./lazfiles.meta.jsonl"))
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

const classifications = [3, 4, 5, 6, 9];

const bounds = metas.reduce(
  (
    a,
    {
      summary: {
        bounds: { minx, miny, maxx, maxy },
      },
    }
  ) =>
    [
      Math.min(a[0], minx),
      Math.min(a[1], miny),
      Math.max(a[2], maxx),
      Math.max(a[3], maxy),
    ] satisfies BBox,
  [Infinity, Infinity, -Infinity, -Infinity] satisfies BBox
);

let i = 0;

const dx = (bounds[2] - bounds[0]) / 160;

const dy = (bounds[3] - bounds[1]) / 80;

const workers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

const queue = new PQueue({
  concurrency: 16,
});

for (let y = bounds[1]; y < bounds[3]; y += dy) {
  for (let x = bounds[0]; x < bounds[2]; x += dx) {
    const index = ++i;

    console.log(`Tile ${index}`);

    // if (
    //   ![
    //     2957, 2958, 2960, 2968, 2969, 2970, 2974, 2975, 2976, 2977, 4242, 4244,
    //     4245, 4246, 4247, 4248, 4249, 4250, 4251,
    //   ].includes(index)
    // ) {
    //   continue;
    // }

    // if (i < 5593) {
    //   continue;
    // }

    // // create grid (geojsonl)
    // console.log(
    //   JSON.stringify({
    //     type: "Feature",
    //     crs: {
    //       type: "name",
    //       properties: {
    //         name: "urn:ogc:def:crs:EPSG::3857",
    //       },
    //     },
    //     properties: { id: index },
    //     geometry: {
    //       type: "Polygon",
    //       coordinates: [
    //         [
    //           [x, y],
    //           [x + dx, y],
    //           [x + dx, y + dy],
    //           [x, y + dy],
    //           [x, y],
    //         ],
    //       ],
    //     },
    //   })
    // );

    // continue;

    const doneFile = `fin2/done-${String(index).padStart(5, "0")}`;

    try {
      await Deno.stat(doneFile);
      continue;
    } catch {
      // OK
    }

    const bbox = [x, y, x + dx, y + dy];

    const files = getFiles(bbox);

    if (files.length === 0) {
      continue;
    }

    await queue.onSizeLessThan(queue.concurrency);

    queue.add(async () => {
      const id = workers.shift();

      try {
        const workdir = "work" + id;

        try {
          await Deno.remove(workdir, { recursive: true });
        } catch {
          // ignore
        }

        await Deno.mkdir(workdir, { recursive: true });

        await filter(index, workdir, files, bbox);

        try {
          await render(index, workdir, files);

          await Promise.all(
            classifications.map((c) =>
              Deno.copyFile(
                workdir + `/binary_${c}.tif`,
                `fin2/binary_${c}-${String(index).padStart(5, "0")}.tif`
              ).catch(() => undefined)
            )
          );

          (await Deno.create(doneFile)).close();

          // await Deno.rename(workdir + "/binary.tif", finFile);
        } catch (e) {
          console.error("Tile:", index, e);

          return;
        }

        console.log(`Done ${index}`);

        await Deno.remove(workdir, { recursive: true });
      } finally {
        workers.unshift(id as number);
      }
    });
  }
}

function getFiles(bbox: number[]) {
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

async function filter(
  index: number,
  workdir: string,
  files: string[],
  bbox: number[]
) {
  console.log(`Filtering ${index}`);

  const t = Date.now();

  await Promise.all(
    files.map((file) => {
      const p = Deno.run({
        cmd: ["/home/martin/fm/PDAL/build/bin/pdal", "pipeline", "-s"],
        stdin: "piped",
      });

      const pipeline = [
        {
          override_srs: "EPSG:8353",
          filename: path.resolve("/home/martin/14TB", file),
        },
        {
          type: "filters.range",
          limits: "Classification[3:9]",
        },
        {
          type: "filters.crop",
          bounds: `([${bbox[0]},${bbox[2]}],[${bbox[1]},${bbox[3]}])`,
        },
        workdir + "/" + path.basename(file),
      ];

      p.stdin?.write(new TextEncoder().encode(JSON.stringify(pipeline)));

      p.stdin?.close();

      return assureSuccess(p);
    })
  );

  console.log(
    `Done filtering ${index} in ${((Date.now() - t) / 60_000).toFixed(2)}`
  );
}

async function render(index: number, workdir: string, files: string[]) {
  console.log(`Rendering ${index}`);

  const t = Date.now();

  const p = Deno.run({
    cmd: ["/home/martin/fm/PDAL/build/bin/pdal", "pipeline", "-s"],
    stdin: "piped",
  });

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
    })),
  ];

  p.stdin?.write(new TextEncoder().encode(JSON.stringify(pipeline)));

  p.stdin?.close();

  await assureSuccess(p);

  console.log(
    `Done rendering ${index} in ${((Date.now() - t) / 60_000).toFixed(2)}`
  );
}
