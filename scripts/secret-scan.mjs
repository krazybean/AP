import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const patterns = [
  /AKIA[0-9A-Z]{16}/,
  /(?:ghp|github_pat|glpat)-[A-Za-z0-9_-]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{20,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const hits = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const pattern of patterns) if (pattern.test(text)) hits.push(file);
}
if (hits.length) {
  console.error(`Potential credential material found in tracked files: ${[...new Set(hits)].join(", ")}`);
  process.exit(1);
}
console.log(`Secret scan passed (${files.length} tracked files, high-confidence patterns only).`);
