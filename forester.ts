import * as path from "https://deno.land/std@0.171.0/path/mod.ts";
import PQueue from "https://esm.sh/p-queue@7.3.0/";
import { assureSuccess } from "./util.ts";

// const bbox = [-253793.51, -1206785.32, -253182.48, -1206227.1];
// const bbox = [-368567.841717, -1233031.480147, -352016.373599, -1219169.419783];

// meta file was created with the following command:
// find /home/martin/14TB -name '*_jtsk03_bpv.laz' | parallel "echo {}; pdal info --summary {} | jq -c" > lazfiles.meta.jsonl

const metas = (await Deno.readTextFile("./lazfiles.meta.jsonl"))
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

const bounds = metas.reduce(
  (
    a,
    {
      summary: {
        bounds: { minx, miny, maxx, maxy },
      },
    }
  ) => [
    Math.min(a[0], minx),
    Math.min(a[1], miny),
    Math.max(a[2], maxx),
    Math.max(a[3], maxy),
  ],
  [Infinity, Infinity, -Infinity, -Infinity]
);

let i = 0;

const dx = (bounds[2] - bounds[0]) / 100;

const dy = (bounds[3] - bounds[1]) / 100;

const workers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

const q = new PQueue({
  concurrency: 3,
});

for (let y = bounds[1]; y < bounds[3]; y += dy) {
  for (let x = bounds[0]; x < bounds[2]; x += dx) {
    console.log(`Tile: ${++i}`);

    if (
      ![
        4158, 4341, 4441, 4442, 4443, 4532, 4541, 4542, 4543, 4642, 4742, 4835,
        4842, 4934, 4936, 5459, 5460, 5461, 5643, 5843, 7045, 7132, 7232, 7233,
        7248, 7332, 7333, 7334, 7435, 7436, 7536, 7552, 7837, 8139, 8140, 8455,
        8556, 8648, 9154, 9255, 9256, 9357, 9358,
      ].includes(i)
    ) {
      continue;
    }

    // create grid (geojsonl)
    // console.log(
    //   JSON.stringify({
    //     type: "Feature",
    //     crs: {
    //       type: "name",
    //       properties: {
    //         name: "urn:ogc:def:crs:EPSG::3857",
    //       },
    //     },
    //     properties: { id: ++i },
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

    const finFile = `fin/binary-${String(i).padStart(5, "0")}.tif`;

    try {
      await Deno.stat(finFile);
      continue;
    } catch {
      // OK
    }

    const bbox = [x, y, x + dx, y + dy];

    const files = getFiles(bbox);

    if (files.length === 0) {
      continue;
    }

    await q.onSizeLessThan(q.concurrency);

    q.add(async () => {
      const id = workers.shift();

      try {
        const workdir = "work" + id;

        try {
          await Deno.remove(workdir, { recursive: true });
        } catch {
          // ignore
        }

        await Deno.mkdir(workdir, { recursive: true });

        await filter(workdir, files, bbox);

        // const numPoints = (
        //   await Promise.all(
        //     files.map(async (file) => {
        //       const cmd = Deno.run({
        //         cmd: [
        //           "pdal",
        //           "info",
        //           "--summary",
        //           // path.resolve("/home/martin/14TB", file),
        //           workdir + "/" + path.basename(file),
        //         ],
        //         stdout: "piped",
        //       });

        //       const num = JSON.parse(
        //         new TextDecoder().decode(await cmd.output())
        //       ).summary.num_points;

        //       cmd.close();

        //       return num;
        //     })
        //   )
        // ).reduce((a, c) => a + c, 0);

        // console.log("Points", numPoints);

        // if (numPoints > 400000000) {
        //   console.log("SKIP");

        //   return;
        // }

        await merge(workdir, files);

        await render(workdir);

        // await render2(files, bbox);

        let nonEmpty = false;

        try {
          await Deno.stat(workdir + "/dsm.tif");

          nonEmpty = true;
        } catch {
          console.log("EMPTY: " + i);
        }

        if (nonEmpty) {
          await calculate(workdir);

          await Deno.rename(workdir + "/binary.tif", finFile);
        }

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

async function filter(workdir: string, files: string[], bbox: number[]) {
  console.log("Filtering");

  await Promise.all(
    files.map((file) => {
      const p = Deno.run({ cmd: ["pdal", "pipeline", "-s"], stdin: "piped" });

      const pipeline = [
        {
          override_srs: "EPSG:8353",
          filename: path.resolve("/home/martin/14TB", file),
        },
        {
          type: "filters.range",
          limits: "Classification[4:5]", // medium and high vegetation
          // limits: "Classification[9:9]", // water
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
}

async function merge(workdir: string, files: string[]) {
  console.log("Merging");

  await assureSuccess(
    Deno.run({
      //     cmd: [
      //       "pdal",
      //       "merge",
      //       ...files.map((file) => workdir + "/" + path.basename(file)),
      //       workdir + "/merged.las",
      //     ],
      cmd: [
        "/home/martin/fm/LAStools/bin/lasmerge",
        "-i",
        ...files.map((file) => workdir + "/" + path.basename(file)),
        "-o",
        workdir + "/merged.las",
      ],
    })
  );
}

async function render(workdir: string) {
  console.log("Rendering");

  // don't fail on KILL because of fatkiller.sh

  await Deno.run({
    cmd: [
      "whitebox_tools",
      // "--quiet",
      "-r=LidarDigitalSurfaceModel",
      "-v",
      "--wd=" + workdir,
      "-i=merged.las",
      "-o=dsm.tif",
      "--resolution=0.5",
      "--max_triangle_edge_length=5",
    ],
  }).status();
}

// async function render2(files: string[], bbox: number[]) {
//   console.log("Rendering");

//   const cmd = [
//     "wine",
//     "/media/martin/OSM/LAStools/bin/las2dem.exe",
//     "-extra_pass",
//     // "-last_only",
//     "-kill",
//     "1",
//     "-step",
//     "0.5",
//     // "-keep_class",
//     // "4",
//     // "5",
//     // "-keep_xy",
//     // ...bbox.map((c) => String(c)),
//     "-i",
//     ...files.map((file) => "work/" + path.basename(file)),
//     // ...files.map((file) => path.resolve("/home/martin/14TB", file)),
//     "-merged",
//     "-o",
//     "work/dsm.tif",
//   ];

//   await assureSuccess(Deno.run({ cmd }));
// }

async function calculate(workdir: string) {
  console.log("Calculating");

  await assureSuccess(
    Deno.run({
      cmd: [
        "gdal_calc.py",
        "--co=NUM_THREADS=ALL_CPUS",
        "--co=COMPRESS=DEFLATE",
        "--co=PREDICTOR=2",
        "--type=Byte",
        "-A",
        workdir + "/dsm.tif",
        "--outfile=" + workdir + "/binary.tif",
        "--overwrite",
        "--hideNoData",
        '--calc="1*(A > -100)"',
      ],
    })
  );

  await assureSuccess(
    Deno.run({
      cmd: ["gdal_edit.py", "-a_srs", "epsg:8353", workdir + "/binary.tif"],
    })
  );
}
