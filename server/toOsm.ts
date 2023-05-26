// main.ts
import { stringify } from "https://deno.land/x/xml@2.1.0/mod.ts";
import type {
  FeatureCollection,
  Polygon,
} from "https://esm.sh/v115/@types/geojson@7946.0.10/index.d.ts";

// Convert GeoJSON coordinates to OSM XML nodes
function coordinatesToNodes(coordinates: number[][], nodeIdStart: number) {
  return coordinates.slice(0, coordinates.length - 1).map((coord, index) => ({
    "@id": -(nodeIdStart + index),
    "@lat": coord[1],
    "@lon": coord[0],
  }));
}

// Convert GeoJSON polygon or hole to OSM XML way
function coordinatesToWay(
  coordinates: number[][],
  nodeIdStart: number,
  wayId: number,
  simple = false
) {
  return {
    "@id": wayId,
    nd: [
      ...coordinates
        .slice(0, coordinates.length - 1)
        .map((_, index) => ({ "@ref": -(nodeIdStart + index) })),
      { "@ref": -nodeIdStart },
    ],
    tag: [
      {
        "@k": "source",
        "@v": "ÚGKK SR LLS",
      },
      ...(simple
        ? [
            {
              "@k": "natural",
              "@v": "wood",
            },
          ]
        : []),
    ],
  };
}

// Create OSM XML relation for the polygon with holes
function createRelation(
  polygon: number[][][],
  relationId: number,
  outerWayId: number
) {
  return {
    "@id": relationId,
    tag: [
      { "@k": "type", "@v": "multipolygon" },
      {
        "@k": "natural",
        "@v": "wood",
      },
      {
        "@k": "source",
        "@v": "ÚGKK SR LLS",
      },
    ],
    member: [
      {
        "@type": "way",
        "@ref": outerWayId,
        "@role": "outer",
      },
      ...polygon.slice(1).map((_hole, index) => ({
        "@type": "way",
        "@ref": outerWayId - (index + 1),
        "@role": "inner",
      })),
    ],
  };
}

// Convert GeoJSON to OSM XML
export function geojsonToOsmXml(geojson: FeatureCollection<Polygon>) {
  const osmXml = {
    osm: {
      "@version": "0.6",
      "@generator": "geojson-to-osm",
      node: [] as unknown[],
      way: [] as unknown[],
      relation: [] as unknown[],
    },
  };

  let nodeIdStart = 1;
  let wayId = -1;

  geojson.features.forEach((feature, i) => {
    if (feature.geometry.type === "Polygon") {
      const nodes = coordinatesToNodes(
        feature.geometry.coordinates[0],
        nodeIdStart
      );

      const simple = feature.geometry.coordinates.length == 1;

      const outerWay = coordinatesToWay(
        feature.geometry.coordinates[0],
        nodeIdStart,
        wayId,
        simple
      );

      nodeIdStart += feature.geometry.coordinates[0].length;

      osmXml.osm.node.push(...nodes);

      osmXml.osm.way.push(outerWay);

      if (!simple) {
        feature.geometry.coordinates.slice(1).forEach((hole: number[][], i) => {
          const holeNodes = coordinatesToNodes(hole, nodeIdStart);
          const holeWay = coordinatesToWay(hole, nodeIdStart, wayId - 1 - i);

          nodeIdStart += hole.length;
          osmXml.osm.node.push(...holeNodes);

          osmXml.osm.way.push(holeWay);
        });

        osmXml.osm.relation.push(
          createRelation(feature.geometry.coordinates, -1 - i, wayId)
        );
      }

      wayId -= feature.geometry.coordinates.length;
    }
  });

  return stringify(osmXml);
}
