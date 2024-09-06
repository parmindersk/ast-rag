//this file gets files recursively from a folder

const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const MAX_FILE_SIZE = 1024 * 1024 * 5; // 5MB
const IGNORES = [
  ".git",
  ".vscode",
  "__pycache__",
  ".DS_Store",
  "node_modules",
  "venv",
  "env",
  "logs",
  "tmp",
  "temp",
  "build",
  "dist",
];
const supportedTypes = {
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const DEFAULT_TYPES = Object.keys(supportedTypes);
const toBeIgnored = new Set(IGNORES);

function getAllFilesOfType(folderPath, fileTypes = DEFAULT_TYPES) {
  if (!folderPath || !fs.existsSync(folderPath)) {
    throw new Error("Folder path must be provided");
  }
  if (toBeIgnored.has(path.basename(folderPath))) {
    return [];
  }
  let files = [];
  let totalSize = 0;
  function traverseDirectory(currentPath) {
    const items = fs.readdirSync(currentPath);

    for (const item of items) {
      const itemPath = path.join(currentPath, item);
      if (toBeIgnored.has(item)) {
        continue;
      }
      const stats = fs.statSync(itemPath);

      if (stats.isDirectory()) {
        traverseDirectory(itemPath);
      } else if (stats.isFile()) {
        const extension = path.extname(itemPath).slice(1);
        if (fileTypes.includes(`.${extension}`)) {
          const mt = mime.lookup(itemPath);
          if (mt && Object.values(supportedTypes).includes(mt)) {
            const fileSize = stats.size;
            if (fileSize > 0 && fileSize < MAX_FILE_SIZE) {
              files.push(itemPath);
              totalSize += fileSize;
            }
          }
        }
      }
    }
  }

  traverseDirectory(folderPath);
  return { files, totalSize };
}

module.exports = {
  getFilesFromFolders: (folders = []) => {
    let files = [];
    let totalSize = 0;
    for (const folder of folders) {
      const { files: folderFiles, totalSize: folderSize } =
        getAllFilesOfType(folder);
      files.push(...folderFiles);
      totalSize += folderSize;
    }
    return { files, totalSize };
  },
};
