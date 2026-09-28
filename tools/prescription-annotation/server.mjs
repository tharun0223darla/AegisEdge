import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import {
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const datasetDir = path.resolve(
  process.argv[2] || path.join(repoRoot, "datasets", "prescription_medicine_detection"),
);
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4677);

const manifestPath = path.join(datasetDir, "manifest.json");
const annotationsPath = path.join(datasetDir, "annotations", "medicine_boxes.coco.json");
const prelabelsPath = path.join(datasetDir, "annotations", "medicine_boxes.geometry_prelabels.coco.json");
const imagesDir = path.join(datasetDir, "images", "raw");
const categories = [
  { id: 1, name: "medicine_name", supercategory: "prescription" },
  { id: 2, name: "non_medicine", supercategory: "prescription" },
];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function safeImagePath(fileName) {
  const target = path.resolve(imagesDir, fileName);
  if (!target.startsWith(imagesDir + path.sep)) {
    return null;
  }
  return target;
}

function loadDataset() {
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing manifest: ${manifestPath}`);
  }
  if (!existsSync(annotationsPath)) {
    throw new Error(`Missing annotations: ${annotationsPath}`);
  }

  const manifest = readJson(manifestPath);
  const annotations = readJson(annotationsPath);
  const prelabels = existsSync(prelabelsPath) ? readJson(prelabelsPath) : null;
  annotations.annotations ||= [];
  annotations.categories = categories;
  annotations.image_statuses ||= {};

  return { manifest, annotations, prelabels };
}

function nextAnnotationId(coco) {
  return (
    coco.annotations.reduce((max, annotation) => Math.max(max, Number(annotation.id) || 0), 0) + 1
  );
}

function updateImageAnnotations(imageId, boxes) {
  const { annotations } = loadDataset();
  const now = new Date().toISOString();
  const image = annotations.images.find((item) => Number(item.id) === imageId);

  if (!image) {
    throw new Error(`Unknown image id: ${imageId}`);
  }

  annotations.annotations = annotations.annotations.filter(
    (annotation) => Number(annotation.image_id) !== imageId,
  );

  let id = nextAnnotationId(annotations);

  for (const box of boxes) {
    const x = Math.max(0, Number(box.x) || 0);
    const y = Math.max(0, Number(box.y) || 0);
    const width = Math.max(1, Number(box.width) || 0);
    const height = Math.max(1, Number(box.height) || 0);

    const label = String(box.label || "medicine_name").trim() || "medicine_name";
    const medicineName = String(box.medicineName || box.medicine_name || "").trim();
    const categoryId = label === "medicine_name" ? 1 : 2;

    annotations.annotations.push({
      id: id++,
      image_id: imageId,
      category_id: categoryId,
      bbox: [
        Number(x.toFixed(2)),
        Number(y.toFixed(2)),
        Number(Math.min(width, image.width - x).toFixed(2)),
        Number(Math.min(height, image.height - y).toFixed(2)),
      ],
      area: Number((width * height).toFixed(2)),
      iscrowd: 0,
      attributes: {
        label,
        medicine_name: medicineName,
        notes: String(box.notes || ""),
        reviewed_at: now,
      },
    });
  }

  annotations.image_statuses[String(imageId)] = {
    status: "reviewed",
    box_count: boxes.length,
    updated_at: now,
  };

  annotations.info ||= {};
  annotations.info.updated_at = now;
  writeJson(annotationsPath, annotations);
}

function exportYolo() {
  const { manifest, annotations } = loadDataset();
  const outputDir = path.join(datasetDir, "exports", "yolo_medicine_name");
  const labelsRoot = path.join(outputDir, "labels");
  const imagesRoot = path.relative(outputDir, imagesDir).replaceAll("\\", "/");
  const imageById = new Map(annotations.images.map((image) => [Number(image.id), image]));
  const annsByImage = new Map();

  for (const ann of annotations.annotations) {
    if (Number(ann.category_id) !== 1) {
      continue;
    }

    const imageId = Number(ann.image_id);
    if (!annsByImage.has(imageId)) {
      annsByImage.set(imageId, []);
    }
    annsByImage.get(imageId).push(ann);
  }

  mkdirSync(outputDir, { recursive: true });

  const splitRows = { train: [], val: [], test: [] };
  for (const image of manifest.images) {
    const split = image.split || "train";
    if (!splitRows[split]) {
      splitRows[split] = [];
    }
    splitRows[split].push(image);
  }

  for (const [split, rows] of Object.entries(splitRows)) {
    mkdirSync(path.join(labelsRoot, split), { recursive: true });
    const listLines = [];

    for (const row of rows) {
      const image = imageById.get(Number(row.id));
      if (!image) {
        continue;
      }

      const stem = path.basename(row.file_name, path.extname(row.file_name));
      const labelPath = path.join(labelsRoot, split, `${stem}.txt`);
      const yoloLines = [];

      for (const ann of annsByImage.get(Number(row.id)) || []) {
        const [x, y, width, height] = ann.bbox.map(Number);
        const cx = (x + width / 2) / image.width;
        const cy = (y + height / 2) / image.height;
        const w = width / image.width;
        const h = height / image.height;
        yoloLines.push(`0 ${cx.toFixed(6)} ${cy.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`);
      }

      writeFileSync(labelPath, `${yoloLines.join("\n")}${yoloLines.length ? "\n" : ""}`, "utf8");
      listLines.push(`${imagesRoot}/${row.file_name}`);
    }

    writeFileSync(path.join(outputDir, `${split}.txt`), `${listLines.join("\n")}\n`, "utf8");
  }

  writeFileSync(
    path.join(outputDir, "data.yaml"),
    [
      "path: .",
      "train: train.txt",
      "val: val.txt",
      "test: test.txt",
      "names:",
      "  0: medicine_name",
      "",
    ].join("\n"),
    "utf8",
  );

  return outputDir;
}

async function exportQwenCrops() {
  const { manifest, annotations } = loadDataset();
  const outputDir = path.join(datasetDir, "exports", "qwen_medicine_name_crops");
  const cropsRoot = path.join(outputDir, "images");
  const imageById = new Map(annotations.images.map((image) => [Number(image.id), image]));
  const manifestById = new Map(manifest.images.map((image) => [Number(image.id), image]));
  const jsonlRows = { train: [], val: [], test: [] };
  const counts = {
    medicine: 0,
    negative: 0,
    skipped_positive_without_name: 0,
  };

  mkdirSync(outputDir, { recursive: true });

  for (const split of Object.keys(jsonlRows)) {
    mkdirSync(path.join(cropsRoot, split), { recursive: true });
  }

  const prompt = [
    "Read this prescription crop.",
    "Return compact JSON only.",
    'Use {"is_medicine":true,"medicine_name":"visible medicine name"} for medicine-name crops.',
    'Use {"is_medicine":false,"medicine_name":null} for signatures, advice, patient details, vitals, stamps, or unreadable non-medicine text.',
    "Return only the medicine name, not dose, schedule, route, quantity, or duration.",
    "Do not guess.",
  ].join(" ");

  for (const ann of annotations.annotations || []) {
    const image = imageById.get(Number(ann.image_id));
    const manifestRow = manifestById.get(Number(ann.image_id));

    if (!image || !manifestRow) {
      continue;
    }

    const label = String(ann.attributes?.label || "medicine_name").trim() || "medicine_name";
    const isMedicine = label === "medicine_name";
    const medicineName = String(ann.attributes?.medicine_name || "").trim();

    if (isMedicine && !medicineName) {
      counts.skipped_positive_without_name += 1;
      continue;
    }

    const [rawX, rawY, rawWidth, rawHeight] = ann.bbox.map(Number);
    const left = Math.max(0, Math.floor(rawX));
    const top = Math.max(0, Math.floor(rawY));
    const width = Math.max(1, Math.min(image.width - left, Math.ceil(rawWidth)));
    const height = Math.max(1, Math.min(image.height - top, Math.ceil(rawHeight)));
    const split = manifestRow.split || "train";

    if (!jsonlRows[split]) {
      jsonlRows[split] = [];
      mkdirSync(path.join(cropsRoot, split), { recursive: true });
    }

    const sourceImagePath = path.join(imagesDir, image.file_name);
    const sourceStem = path.basename(image.file_name, path.extname(image.file_name));
    const cropFileName = `${sourceStem}_ann_${String(ann.id).padStart(5, "0")}.jpg`;
    const cropRelativePath = path.join("images", split, cropFileName).replaceAll("\\", "/");
    const cropOutputPath = path.join(outputDir, cropRelativePath);

    await sharp(sourceImagePath)
      .extract({ left, top, width, height })
      .jpeg({ quality: 95 })
      .toFile(cropOutputPath);

    const assistantPayload = {
      is_medicine: isMedicine,
      medicine_name: isMedicine ? medicineName : null,
      row_type: isMedicine ? "medicine" : label,
    };

    jsonlRows[split].push(
      JSON.stringify({
        id: `${sourceStem}_ann_${ann.id}`,
        image: cropRelativePath,
        source_image: image.file_name,
        bbox: [left, top, width, height],
        label,
        medicine_name: isMedicine ? medicineName : null,
        messages: [
          { role: "user", content: prompt },
          { role: "assistant", content: JSON.stringify(assistantPayload) },
        ],
      }),
    );

    if (isMedicine) {
      counts.medicine += 1;
    } else {
      counts.negative += 1;
    }
  }

  for (const [split, rows] of Object.entries(jsonlRows)) {
    writeFileSync(path.join(outputDir, `${split}.jsonl`), `${rows.join("\n")}${rows.length ? "\n" : ""}`, "utf8");
  }

  writeJson(path.join(outputDir, "summary.json"), {
    outputDir,
    counts,
    files: Object.fromEntries(
      Object.entries(jsonlRows).map(([split, rows]) => [`${split}.jsonl`, rows.length]),
    ),
  });

  return { outputDir, counts };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function serveStatic(res, filePath, contentType) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  res.writeHead(200, { "content-type": contentType });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${host}:${port}`);

    if (req.method === "GET" && url.pathname === "/") {
      serveStatic(res, path.join(__dirname, "index.html"), "text/html; charset=utf-8");
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/dataset") {
      const { manifest, annotations, prelabels } = loadDataset();
      sendJson(res, 200, { datasetDir, manifest, annotations, prelabels });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/images/")) {
      const fileName = decodeURIComponent(url.pathname.slice("/images/".length));
      const imagePath = safeImagePath(fileName);
      if (!imagePath) {
        sendJson(res, 400, { error: "Invalid image path" });
        return;
      }
      serveStatic(res, imagePath, "image/jpeg");
      return;
    }

    const saveMatch = url.pathname.match(/^\/api\/annotations\/(\d+)$/);
    if (req.method === "POST" && saveMatch) {
      const imageId = Number(saveMatch[1]);
      const body = await readRequestBody(req);
      updateImageAnnotations(imageId, Array.isArray(body.boxes) ? body.boxes : []);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/export-yolo") {
      const outputDir = exportYolo();
      sendJson(res, 200, { ok: true, outputDir });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/export-qwen") {
      const result = await exportQwenCrops();
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, host, () => {
  console.log(`Prescription annotator: http://${host}:${port}`);
  console.log(`Dataset: ${datasetDir}`);
});
