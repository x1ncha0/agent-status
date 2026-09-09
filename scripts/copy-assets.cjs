const fs = require('node:fs');
for (const name of ['index.html', 'style.css']) {
  fs.copyFileSync(`src/renderer/${name}`, `dist/renderer/${name}`);
}
