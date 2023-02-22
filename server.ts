import { readableStreamFromReader } from "https://deno.land/std@0.171.0/streams/readable_stream_from_reader.ts";
import { writableStreamFromWriter } from "https://deno.land/std@0.171.0/streams/writable_stream_from_writer.ts";
import { assureSuccess } from "./util.ts";

const server = Deno.listen({ port: 8080 });

for await (const conn of server) {
  serveHttp(conn);
}

async function serveHttp(conn: Deno.Conn) {
  const httpConn = Deno.serveHttp(conn);

  for await (const requestEvent of httpConn) {
    const { request } = requestEvent;

    const url = new URL(request.url);

    if (request.method !== "GET") {
      requestEvent.respondWith(
        new Response("method not allowed", { status: 405 })
      );

      continue;
    }

    if (url.pathname !== "/") {
      requestEvent.respondWith(new Response("not found", { status: 404 }));

      continue;
    }

    const { searchParams } = url;

    const classifications = searchParams
      .get("classifications")
      ?.split(",")
      .map(Number);

    const mask = searchParams.get("mask");

    if (!mask || !classifications) {
      requestEvent.respondWith(new Response("invalid params", { status: 400 }));

      continue;
    }

    const workdir = await Deno.makeTempDir({
      prefix: "work_",
      dir: "./server-work",
    });

    try {
      await Deno.writeTextFile(workdir + "/mask.geojson", mask);
    } finally {
      await Deno.remove(workdir, { recursive: true });
    }

    await process(workdir, classifications, requestEvent);

    // requestEvent.respondWith(new Response("OK"));
  }
}

async function process(
  workdir: string,
  classifications: number[],
  requestEvent: Deno.RequestEvent
) {
  {
    console.log("Checking size");

    const p = await assureSuccess(
      Deno.run({
        cwd: workdir,
        cmd: [
          "ogrinfo",
          "-q",
          "-dialect",
          "SQLite",
          "-sql",
          "SELECT SUM(ST_Area(st_transform(geometry, 8353))) AS area FROM mask",
          "mask.geojson",
        ],
        stdout: "piped",
      })
    );

    const output = new TextDecoder().decode(await p.output());

    const area = Number(/area \(Real\) = ([\d\.]*)/.exec(output)?.[1]);

    if (!area || area > 200_000_000) {
      throw new Error("area too big");
    }
  }

  console.log("Cropping");

  await Promise.all(
    classifications.map((classification) =>
      assureSuccess(
        Deno.run({
          cwd: workdir,
          cmd: [
            "gdalwarp",
            "-cutline",
            "mask.geojson",
            "-crop_to_cutline",
            `../fin/merged_${classification}.vrt`,
            `cut_${classification}.tif`,
          ],
        })
      )
    )
  );

  console.log("Calculating");

  await assureSuccess(
    Deno.run({
      cwd: workdir,
      cmd: [
        "gdal_calc.py",
        "--co=NUM_THREADS=ALL_CPUS",
        "--co=COMPRESS=DEFLATE",
        "--co=PREDICTOR=2",
        "--type=Byte",
        ...classifications.flatMap((classification, i) => [
          "-" + "ABCDEFGH".charAt(i),
          `cut_${classification}.tif`,
        ]),
        "--outfile=binary.tif",
        "--hideNoData",
        `--calc="${classifications
          .map((_classification, i) => `1 * (${"ABCDEFGH".charAt(i)} > 0)`)
          .join(" + ")}"`,
      ],
    })
  );

  console.log("Setting SRS");

  await assureSuccess(
    Deno.run({
      cwd: workdir,
      cmd: ["gdal_edit.py", "-a_srs", "epsg:8353", "binary.tif"],
    })
  );

  console.log("Majority filtering");

  await assureSuccess(
    Deno.run({
      cwd: workdir,
      cmd: [
        "whitebox_tools",
        "-r=MajorityFilter",
        "-v",
        "--wd=.",
        "-i=binary.tif",
        "-o=mf.tif",
        "--filter=19",
      ],
    })
  );

  console.log("Polygonizing");

  await assureSuccess(
    Deno.run({
      cwd: workdir,
      cmd: ["gdal_polygonize.py", "mf.tif", "out.shp"],
    })
  );

  console.log("Setting SRS");

  await assureSuccess(
    Deno.run({
      cwd: workdir,
      cmd: [
        "ogr2ogr",
        "-overwrite",
        "-a_srs",
        "epsg:8353",
        "-where",
        '"DN" = 1',
        "out8353.shp",
        "out.shp",
      ],
    })
  );

  console.log("Generalizing");

  await assureSuccess(
    Deno.run({
      cwd: workdir,
      cmd: [
        "grass",
        "--tmp-location",
        "EPSG:8353",
        "--exec",
        "sh",
        "../grass_batch_job.sh",
      ],
    })
  );

  console.log("Converting to geojson");

  await assureSuccess(
    Deno.run({
      cwd: workdir,
      cmd: [
        "ogr2ogr",
        "-overwrite",
        "-t_srs",
        "epsg:4326",
        "out.geojson",
        "generalized.gpkg",
      ],
    })
  );

  {
    console.log("Adding tags");

    const p = Deno.run({
      cwd: workdir,
      cmd: [
        "jq",
        '.features[].properties = {natural: "wood", source: "ÚGKK SR LLS"}',
        "out.geojson",
      ],
      stdout: "piped",
    });

    // readableStreamFromReader(p.stdout).pipeTo(
    //   writableStreamFromWriter(
    //     await Deno.open(workdir + "/result.geojson", {
    //       read: true,
    //       write: true,
    //       create: true,
    //     })
    //   )
    // );

    await Promise.all([
      requestEvent.respondWith(
        new Response(readableStreamFromReader(p.stdout), {
          headers: { "Content-Type": "application/geo+json" },
        })
      ),
      assureSuccess(p),
    ]);
  }
}
