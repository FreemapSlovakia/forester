import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

await serve(handler, { port: 8080 });

async function handler(request: Request) {
  console.log("REQUEST");

  try {
    const url = new URL(request.url);

    if (request.method !== "GET") {
      return new Response("method not allowed", { status: 405 });
    }

    if (url.pathname !== "/") {
      return new Response("not found", { status: 404 });
    }

    const { searchParams } = url;

    const classifications = searchParams
      .get("classifications")
      ?.split(",")
      .map(Number);

    const mask = searchParams.get("mask");

    if (!mask || !classifications) {
      return new Response("invalid params", { status: 400 });
    }

    const workdir = await Deno.makeTempDir({
      prefix: "work_",
      dir: "./server-work",
    });

    await Deno.writeTextFile(workdir + "/mask.geojson", mask);

    const childProcesses = new Set<Deno.ChildProcess>();

    let iid: number;

    const body = new ReadableStream({
      start(controller) {
        iid = setInterval(() => {
          controller.enqueue(new Uint8Array(0));
        }, 500);
      },
      async pull(controller) {
        try {
          controller.enqueue(
            await process(workdir, classifications, childProcesses)
          );
        } finally {
          controller.close();

          clearInterval(iid);

          await Deno.remove(workdir, { recursive: true });
        }
      },

      async cancel() {
        console.log("CANCEL");

        clearInterval(iid);

        for (const childProcess of childProcesses) {
          try {
            childProcess.kill("SIGTERM");
          } catch {
            // ignore
          }
        }

        await Deno.remove(workdir, { recursive: true });
      },
    });

    return new Response(body, {
      headers: { "Content-Type": "application/geo+json" },
    });
  } catch (err) {
    console.error(err);

    return new Response("internal server error", { status: 500 });
  }
}

async function process(
  workdir: string,
  classifications: number[],
  childProcesses: Set<Deno.ChildProcess>
) {
  async function runCommand(
    command: string,
    options?: Deno.CommandOptions,
    childProcessesEx?: Set<Deno.ChildProcess>
  ) {
    const childProcess = new Deno.Command(command, options).spawn();

    childProcesses.add(childProcess);

    childProcessesEx?.add(childProcess);

    const commandOutput = await childProcess.output();

    childProcesses.delete(childProcess);

    childProcessesEx?.delete(childProcess);

    if (!commandOutput.success) {
      throw new Error(command + " failed: " + commandOutput.code);
    }

    return commandOutput;
  }

  {
    console.log("Checking size");

    const commandOutput = await runCommand("ogrinfo", {
      cwd: workdir,
      args: [
        "-q",
        "-dialect",
        "SQLite",
        "-sql",
        "SELECT SUM(ST_Area(st_transform(geometry, 8353))) AS area FROM mask",
        "mask.geojson",
      ],
      stdout: "piped",
    });

    const output = new TextDecoder().decode(commandOutput.stdout);

    const area = Number(/area \(Real\) = ([\d\.]*)/.exec(output)?.[1]);

    if (!area || area > 200_000_000) {
      throw new Error("area too big");
    }
  }

  console.log("Cropping");

  const childProcessesEx = new Set<Deno.ChildProcess>();

  try {
    await Promise.all(
      classifications.map((classification) =>
        runCommand(
          "gdalwarp",
          {
            cwd: workdir,
            args: [
              "-cutline",
              "mask.geojson",
              "-crop_to_cutline",
              `../../fin2/merged_${classification}.vrt`,
              `cut_${classification}.tif`,
            ],
          },
          childProcessesEx
        )
      )
    );
  } catch (err) {
    for (const childProcess of childProcessesEx) {
      try {
        childProcess.kill("SIGTERM");
      } catch {
        // ignore
      }
    }

    throw err;
  }

  console.log("Calculating");

  await runCommand("gdal_calc.py", {
    cwd: workdir,
    args: [
      "--co=NUM_THREADS=ALL_CPUS",
      // "--co=COMPRESS=DEFLATE",
      // "--co=PREDICTOR=2",
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
  });

  console.log("Setting SRS");

  await runCommand("gdal_edit.py", {
    cwd: workdir,
    args: ["-a_srs", "epsg:8353", "binary.tif"],
  });

  console.log("Majority filtering");

  await runCommand("whitebox_tools", {
    cwd: workdir,
    args: [
      "-r=MajorityFilter",
      "-v",
      "--wd=.",
      "-i=binary.tif",
      "-o=mf.tif",
      "--filter=19",
    ],
  });

  console.log("Polygonizing");

  await runCommand("gdal_polygonize.py", {
    cwd: workdir,
    args: ["mf.tif", "out.shp"],
  });

  console.log("Setting SRS");

  await runCommand("ogr2ogr", {
    cwd: workdir,
    args: [
      "-overwrite",
      "-a_srs",
      "epsg:8353",
      "-where",
      '"DN" = 1',
      "out8353.shp",
      "out.shp",
    ],
  });

  console.log("Generalizing");

  await runCommand("grass", {
    cwd: workdir,
    args: [
      "--tmp-location",
      "EPSG:8353",
      "--exec",
      "sh",
      "../../grass_batch_job.sh",
    ],
  });

  console.log("Converting to geojson");

  await runCommand("ogr2ogr", {
    cwd: workdir,
    args: [
      "-overwrite",
      "-t_srs",
      "epsg:4326",
      "out.geojson",
      "generalized.gpkg",
    ],
  });

  {
    console.log("Adding tags");

    const commandOutput = await runCommand("jq", {
      cwd: workdir,
      args: [
        '.features[].properties = {natural: "wood", source: "ÚGKK SR LLS"}',
        "out.geojson",
      ],
      stdout: "piped",
    });

    return commandOutput.stdout;
  }
}
