import { BBox, filter, getFiles, getMetas, render } from "./functions.ts";

const bbox: BBox = [-264913, -1240751, -264246, -1240287];

const metas = await getMetas();


const files = getFiles(bbox, metas);

await filter(0, ".", files, bbox, null);

await render(0, ".", files, [0], bbox);


/*
R
library(lidR)
library(raster)


las = readLAS("/home/martin/fm/forester/preprocessing/normalized.laz")
las2 <- classify_noise(las, ivf(res = 5, n = 6))
las3 <- filter_poi(las2, Classification != 18)
ttops <- locate_trees(las3, lmf(ws = 10, hmin = 10))

writeRaster(chm, filename = "/home/martin/path_to_your_file.tif", overwrite=TRUE)
p <- plot(las3, color = "Classification", bg = "white", axis = TRUE, legend = TRUE, size = 3)
add_treetops3d(p, ttops)

chm <- rasterize_canopy(las3, 0.5, pitfree(subcircle = 0.2))
plot(chm, col = height.colors(50))
plot(sf::st_geometry(ttops), add = TRUE, pch = 3)
library(sf)
library(rgdal)
st_write(sf::st_geometry(ttops), "/home/martin/meuse.geojson", overwrite=TRUE)

*/
