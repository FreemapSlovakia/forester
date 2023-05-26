import PQueue from "https://esm.sh/p-queue@7.3.0/";
import { BBox, filter, getFiles, getMetas, render } from "./functions.ts";

// <configuration>

const classifications = [3, 4, 5, 6, 9];

const targetDir = "fin";

const workdirPrefix = "work";

const concurrency = 16;

// </configuration>

const metas = await getMetas();

const bounds = metas.reduce(
  (
    bbox,
    {
      summary: {
        bounds: { minx, miny, maxx, maxy },
      },
    }
  ) =>
    [
      Math.min(bbox[0], minx),
      Math.min(bbox[1], miny),
      Math.max(bbox[2], maxx),
      Math.max(bbox[3], maxy),
    ] satisfies BBox,
  [Infinity, Infinity, -Infinity, -Infinity] satisfies BBox
);

let i = 0;

// TODO target align pixels - origin and dimension (*TAP)
const dx = (bounds[2] - bounds[0]) / 160;

const dy = (bounds[3] - bounds[1]) / 80;

const workers = new Array(concurrency).fill(0).map((_, i) => i);

const queue = new PQueue({ concurrency });

for (let y = bounds[1]; y < bounds[3]; y += dy) {
  for (let x = bounds[0]; x < bounds[2]; x += dx) {
    const index = ++i;

    console.log(`Tile ${index}`);

    // // create grid (geojsonl)
    // console.log(
    //   JSON.stringify({
    //     type: "Feature",
    //     crs: {
    //       type: "name",
    //       properties: {
    //         name: "urn:ogc:def:crs:EPSG::8353",
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
    //
    // continue;

    const doneFile = targetDir + "/done-" + String(index).padStart(5, "0");

    try {
      await Deno.stat(doneFile);
      continue;
    } catch {
      // OK
    }

    const bbox: BBox = [x, y, x + dx, y + dy];

    const files = getFiles(bbox, metas);

    if (files.length === 0) {
      continue;
    }

    await queue.onSizeLessThan(queue.concurrency);

    queue.add(async () => {
      const id = workers.shift();

      try {
        const workdir = workdirPrefix + id;

        try {
          await Deno.remove(workdir, { recursive: true });
        } catch {
          // ignore
        }

        await Deno.mkdir(workdir, { recursive: true });

        await filter(index, workdir, files, bbox);

        try {
          await render(index, workdir, files, classifications, bbox);

          await Promise.all(
            classifications.map((c) =>
              Deno.copyFile(
                `${workdir}/binary_${c}.tif`,
                `${targetDir}/binary_${c}-${String(index).padStart(5, "0")}.tif`
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
