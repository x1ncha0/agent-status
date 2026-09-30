const fs = require('node:fs');
const crypto = require('node:crypto');
fs.cpSync('integration', 'release/integration', { recursive: true });
for (const file of ['README.md', 'RELEASE_NOTES.md']) fs.copyFileSync(file, `release/${file}`);
const artifacts = fs
  .readdirSync('release')
  .filter((name) => name === 'AgentStatus.exe' || /^AgentStatus-mac-(arm64|x64)\.dmg$/.test(name));
if (!artifacts.length) throw new Error('No release artifact found in release/.');
for (const name of artifacts) {
  const digest = crypto
    .createHash('sha256')
    .update(fs.readFileSync(`release/${name}`))
    .digest('hex');
  fs.writeFileSync(`release/${name}.sha256`, `${digest}  ${name}\n`);
}
console.log(
  `Packaged ${artifacts.join(', ')} with SHA256, integration scripts and documentation in release/.`,
);
