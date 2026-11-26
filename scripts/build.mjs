/**
 * 《微风垂钓物语 2.0》零依赖静态发布目录构建脚本 (scripts/build.mjs)
 * ----------------------------------------------------------------------------
 * 将前端发布所需的 index.html、manifest.webmanifest、css/、js/、shared/ 同步构建至 dist/。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

const COPY_FILES = [
  'index.html',
  'manifest.webmanifest'
];

const COPY_DIRS = [
  'css',
  'js',
  'shared'
];

function copyDirRecursive(srcDir, destDir, copied) {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, copied);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      const stat = fs.statSync(destPath);
      copied.push({
        path: path.relative(ROOT_DIR, destPath).replace(/\\/g, '/'),
        bytes: stat.size
      });
    }
  }
}

export function buildDist() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const copied = [];
  for (const relFile of COPY_FILES) {
    const srcPath = path.join(ROOT_DIR, relFile);
    if (!fs.existsSync(srcPath)) {
      throw new Error(`缺失发布必需文件: ${relFile}`);
    }
    const destPath = path.join(DIST_DIR, relFile);
    fs.copyFileSync(srcPath, destPath);
    const stat = fs.statSync(destPath);
    copied.push({
      path: path.relative(ROOT_DIR, destPath).replace(/\\/g, '/'),
      bytes: stat.size
    });
  }

  for (const relDir of COPY_DIRS) {
    const srcDir = path.join(ROOT_DIR, relDir);
    if (!fs.existsSync(srcDir)) {
      throw new Error(`缺失发布必需目录: ${relDir}`);
    }
    copyDirRecursive(srcDir, path.join(DIST_DIR, relDir), copied);
  }

  const totalBytes = copied.reduce((acc, item) => acc + item.bytes, 0);
  return { fileCount: copied.length, totalBytes, files: copied };
}

if (path.resolve(process.argv[1] || '') === __filename) {
  const result = buildDist();
  console.log(`[build] dist/ 构建完成：共 ${result.fileCount} 个文件，总计 ${(result.totalBytes / 1024).toFixed(1)} KB`);
}
