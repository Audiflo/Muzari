#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function flatten(obj, prefix) {
  prefix = prefix || "";
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + "." + k : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

const BUILD_DIR = path.resolve(__dirname, "..");
const LOCALE_DIR = path.join(BUILD_DIR, "src", "locales");
const TMP_DIR = path.join(BUILD_DIR, ".i18n-drift-tmp");

const DOMAINS = ["common","actions","playlist","settings","player","home","lyrics","discord","exports","favorites","filePicker","folder","songInfo","sort","update","visualizers","visualizer","icon","rating","noResults","delete","batch","fileHandler","shareTarget","help","accessibility","about","search"];

const WHITELIST = new Set([
  "visualizers.bars.settings.barCount",
  "visualizers.bars.settings.spacing",
  "visualizers.bars.settings.smoothing",
  "visualizers.bars.settings.mirror",
  "visualizers.bars.settings.fftSize",
  "visualizers.waveform.settings.thickness",
  "visualizers.waveform.settings.smoothing",
  "visualizers.waveform.settings.amplitude",
  "visualizers.circle.settings.radius",
  "visualizers.circle.settings.rotationSpeed",
  "visualizers.circle.settings.smoothing",
  "visualizers.circle.settings.barCount",
  "playlist.m3u.mode.auto",
  "playlist.m3u.mode.path",
  "playlist.m3u.mode.filename",
]);

function loadCommittedKeys(locale) {
  const merged = {};
  const generalPath = path.join(LOCALE_DIR, locale, "general.json");
  if (fs.existsSync(generalPath)) {
    Object.assign(merged, JSON.parse(fs.readFileSync(generalPath, "utf8")));
  }
  for (const d of DOMAINS) {
    const dpath = path.join(LOCALE_DIR, locale, d + ".json");
    if (fs.existsSync(dpath)) {
      merged[d] = JSON.parse(fs.readFileSync(dpath, "utf8"));
    }
  }
  return flatten(merged);
}

function hasKeyOrPlural(committedKeys, key) {
  if (committedKeys.has(key)) return true;
  const pluralSuffixes = ["_one", "_other", "_zero", "_two", "_few", "_many"];
  for (const suffix of pluralSuffixes) {
    if (committedKeys.has(key + suffix)) return true;
  }
  for (const suffix of pluralSuffixes) {
    if (key.endsWith(suffix)) {
      const base = key.slice(0, -suffix.length);
      if (committedKeys.has(base)) return true;
    }
  }
  return false;
}

function main() {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });

    const config = path.join(BUILD_DIR, "i18next-parser.config.cjs");
    execFileSync(
      "node",
      [
        "node_modules/i18next-parser/bin/cli.js",
        "--config",
        config,
        "--output",
        ".i18n-drift-tmp/$LOCALE/$NAMESPACE.json",
      ],
      {
        cwd: BUILD_DIR,
        stdio: "inherit",
      },
    );

    let failed = false;

    for (const locale of ["en", "fr"]) {
      const extractedPath = path.join(TMP_DIR, locale, "translation.json");
      if (!fs.existsSync(extractedPath)) {
        console.error(`Missing extracted keys for ${locale}`);
        failed = true;
        continue;
      }

      const extracted = JSON.parse(fs.readFileSync(extractedPath, "utf8"));
      const extractedFlat = flatten(extracted);
      const committedFlat = loadCommittedKeys(locale);

      const extractedKeys = new Set(Object.keys(extractedFlat));
      const committedKeys = new Set(Object.keys(committedFlat));

      const missing = [...extractedKeys].filter(k => !hasKeyOrPlural(committedKeys, k) && !WHITELIST.has(k));

      if (missing.length > 0) {
        console.error(`\n[${locale}] Missing translations (used in code but not in committed files):`);
        for (const k of missing.sort()) console.error(`  - ${k}`);
        failed = true;
      }
    }

    fs.rmSync(TMP_DIR, { recursive: true, force: true });

    if (failed) {
      console.error("\n❌ i18n drift check failed");
      process.exit(1);
    }

    console.log("\n✅ i18n drift check passed");
    process.exit(0);
  } catch (e) {
    console.error("Error:", e.message);
    process.exit(1);
  }
}

main();
