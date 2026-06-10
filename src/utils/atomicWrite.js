'use strict';

const fs = require('fs');
const path = require('path');

function atomicWriteFile(filePath, data, encoding = 'utf8') {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeFileSync(fd, data, encoding);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tmpPath, filePath);

  try {
    const dirFd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  } catch {}
}

function atomicWriteJson(filePath, value) {
  atomicWriteFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

module.exports = { atomicWriteFile, atomicWriteJson };
