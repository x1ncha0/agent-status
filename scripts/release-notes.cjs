const fs = require('node:fs');
const version = process.argv[2];
const lines = fs.readFileSync('RELEASE_NOTES.md', 'utf8').split(/\r?\n/);
const start = lines.findIndex((line) => line.startsWith(`## ${version} `));
if (start < 0) throw new Error(`RELEASE_NOTES.md has no section for ${version}.`);
const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
process.stdout.write(
  lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join('\n')
    .trim() + '\n',
);
