#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const COLORS = {
  reset: "\x1b[0m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
};

const args = process.argv.slice(2);
// -I values are matched as literal path substrings rather than compiled into a
// RegExp: the argument comes from the command line, and building a pattern from
// it would allow regex injection (catastrophic backtracking) if ever driven by
// untrusted input. Substring matching covers the documented file/folder usage.
let ignorePaths = [];
let ignoreConsole = false;
let ignoreThrows = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "-I" && args[i + 1]) {
    ignorePaths.push(args[i + 1]);
    i++;
  } else if (args[i] === "--ignore-console") {
    ignoreConsole = true;
  } else if (args[i] === "--ignore-throws") {
    ignoreThrows = true;
  }
}

const projectRoot = process.cwd();

const textRegex = /(["'`])([A-Z][^"'`]{2,})\1/g;
const jsxTextRegex = />\s*([A-Z][^<>{}]{2,})\s*</g;

let candidateCount = 0;

function scanFile(filePath) {
  if (ignorePaths.some((entry) => filePath.includes(entry))) return;

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  let inConsoleCall = false;
  let inThrowStatement = false;
  let parenDepth = 0;

  lines.forEach((line, index) => {
    if (/^\s*(import|export)\s/.test(line) || /require\s*\(/.test(line)) return;

    if (ignoreConsole) {
      if (!inConsoleCall && /console\.\w+\s*\(/.test(line)) {
        inConsoleCall = true;
        parenDepth = 0;
      }

      if (inConsoleCall) {
        for (let char of line) {
          if (char === '(') parenDepth++;
          if (char === ')') parenDepth--;
        }

        if (parenDepth <= 0) {
          inConsoleCall = false;
          return;
        }
        return;
      }
    }

    if (ignoreThrows) {
      if (!inThrowStatement && /(throw\s+new\s+\w*Error\s*\(|reject\s*\(\s*new\s+\w*Error\s*\()/.test(line)) {
        inThrowStatement = true;
        parenDepth = 0;
      }

      if (inThrowStatement) {
        for (let char of line) {
          if (char === '(') parenDepth++;
          if (char === ')') parenDepth--;
        }

        if (parenDepth <= 0) {
          inThrowStatement = false;
          return;
        }
        return;
      }
    }

    let match;
    while ((match = textRegex.exec(line)) !== null) {
      const text = match[2].trim();
      if (shouldIgnore(text)) continue;
      report(filePath, index + 1, text, "string");
    }

    if (!/\bas\s+\w+<|Promise<|Array<|Map<|Set</.test(line)) {
      while ((match = jsxTextRegex.exec(line)) !== null) {
        const text = match[1].trim();
        if (shouldIgnore(text)) continue;
        report(filePath, index + 1, text, "jsx");
      }
    }
  });
}

function shouldIgnore(str) {
  return (
    /^https?:\/\//.test(str) ||
    /^\/?[\w./-]+$/.test(str) ||
    /^\d+$/.test(str) ||
    str.length < 3
  );
}

function report(file, line, text, type) {
  candidateCount++;
  const color = type === "jsx" ? COLORS.blue : COLORS.magenta;
  console.log(
    `${COLORS.cyan}${file}:${COLORS.yellow}${line}${COLORS.reset} -> ${color}"${text}"${COLORS.reset} ${COLORS.green}[${type}]${COLORS.reset}`
  );
}

function scanDir(dir) {
  if (ignorePaths.some((entry) => dir.includes(entry))) return;

  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (["node_modules", "dist", "build"].includes(entry)) continue;
      scanDir(fullPath);
    } else if (/\.(tsx?|jsx?)$/.test(entry)) {
      scanFile(fullPath);
    }
  }
}

console.log(`${COLORS.green}Scanning for i18n candidates...${COLORS.reset}\n`);
scanDir(projectRoot);
console.log(
  `\n${COLORS.green}Done.${COLORS.reset} ${COLORS.yellow}Found ${candidateCount} i18n candidate${candidateCount === 1 ? "" : "s"}.${COLORS.reset}`
);
