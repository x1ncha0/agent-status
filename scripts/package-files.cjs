const fs = require('node:fs');
const crypto = require('node:crypto');
fs.cpSync('integration', 'release/integration', { recursive: true });
for (const file of ['README.md', 'VERIFICATION.md', 'RELEASE_NOTES.md']) fs.copyFileSync(file, `release/${file}`);
const digest = crypto.createHash('sha256').update(fs.readFileSync('release/AgentStatus.exe')).digest('hex');
fs.writeFileSync('release/AgentStatus.exe.sha256', `${digest}  AgentStatus.exe\n`);
console.log('Executable, integration scripts, documentation and SHA256 are in release/.');
