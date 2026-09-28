import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const datasetDir = path.resolve(
  process.argv[2] || path.join(repoRoot, "datasets", "prescription_medicine_detection"),
);
const manifestPath = path.join(datasetDir, "manifest.json");
const annotationsPath = path.join(datasetDir, "annotations", "medicine_boxes.coco.json");
const prelabelsPath = path.join(datasetDir, "annotations", "medicine_boxes.geometry_prelabels.coco.json");
const imagesDir = path.join(datasetDir, "images", "raw");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

const manifest = readJson(manifestPath);
const coco = readJson(annotationsPath);
const imagesById = new Map(coco.images.map((image) => [Number(image.id), image]));
const manifestById = new Map(manifest.images.map((image) => [Number(image.id), image]));

const splitCounts = { train: 0, val: 0, test: 0 };
const reviewed = new Set(Object.entries(coco.image_statuses || {})
  .filter(([, value]) => value.status === "reviewed")
  .map(([key]) => Number(key)));

for (const image of manifest.images) {
  splitCounts[image.split] = (splitCounts[image.split] || 0) + 1;

  if (!imagesById.has(Number(image.id))) {
    fail(`Manifest image missing from COCO: ${image.file_name}`);
  }

  const imagePath = path.join(imagesDir, image.file_name);
  if (!existsSync(imagePath)) {
    fail(`Image file missing: ${imagePath}`);
  }
}

for (const image of coco.images) {
  if (!manifestById.has(Number(image.id))) {
    fail(`COCO image missing from manifest: ${image.file_name}`);
  }
}

for (const ann of coco.annotations || []) {
  const image = imagesById.get(Number(ann.image_id));
  if (!image) {
    fail(`Annotation references unknown image id ${ann.image_id}`);
    continue;
  }

  const [x, y, width, height] = ann.bbox.map(Number);
  if (width <= 0 || height <= 0) {
    fail(`Annotation ${ann.id} has non-positive size`);
  }
  if (x < 0 || y < 0 || x + width > image.width + 0.5 || y + height > image.height + 0.5) {
    fail(`Annotation ${ann.id} is outside image bounds for ${image.file_name}`);
  }
}

const totalAnnotations = (coco.annotations || []).length;
const annotatedImages = new Set((coco.annotations || []).map((ann) => Number(ann.image_id))).size;
const labelCounts = {};
let prelabelCount = 0;
let prelabelImageCount = 0;

for (const ann of coco.annotations || []) {
  const label = String(ann.attributes?.label || "medicine_name");
  labelCounts[label] = (labelCounts[label] || 0) + 1;
}

if (existsSync(prelabelsPath)) {
  const prelabels = readJson(prelabelsPath);
  prelabelCount = (prelabels.annotations || []).length;
  prelabelImageCount = new Set((prelabels.annotations || []).map((ann) => Number(ann.image_id))).size;
}

console.log("Prescription detection dataset");
console.log(`Dataset: ${datasetDir}`);
console.log(`Images: ${manifest.images.length}`);
console.log(`Splits: train=${splitCounts.train || 0}, val=${splitCounts.val || 0}, test=${splitCounts.test || 0}`);
console.log(`Reviewed images: ${reviewed.size}`);
console.log(`Images with boxes: ${annotatedImages}`);
console.log(`Boxes: ${totalAnnotations}`);
for (const [label, count] of Object.entries(labelCounts).sort()) {
  console.log(`  ${label}: ${count}`);
}
console.log(`Geometry prelabel images: ${prelabelImageCount}`);
console.log(`Geometry prelabel boxes: ${prelabelCount}`);

if (process.exitCode) {
  console.log("Validation finished with errors.");
} else {
  console.log("Validation passed.");
}
