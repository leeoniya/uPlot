import fs from 'node:fs/promises';
import path from 'path';

import MCR from 'monocart-coverage-reports';

const mcr = MCR({
  name: 'My Coverage Report - 2024-02-28',
  outputDir: './coverage-reports',
  reports: ["html", "console-details"],
  cleanCache: true,
  sourceMap: true,
  sourcePath: (filePath, info) => {
    console.log(filePath);
    if (!filePath.includes('/') && info.distFile) {
      return `${path.dirname(info.distFile)}/${filePath}`;
    }
    return filePath;
  }

});

async function readFirstJson(directoryPath) {
  try {
    const files = await fs.readdir(directoryPath);
    const firstJsonFile = files.find(file => path.extname(file) === '.json');

    if (!firstJsonFile) {
      console.log('No JSON file found.');
      return null;
    }

    const filePath = path.join(directoryPath, firstJsonFile);
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading directory or file:', err);
  }
}

(async () => {
  const json = await readFirstJson('.nyc_output');
  await mcr.add(json);
  await mcr.generate();
})();