// Spawns BOT_COUNT bots, each with its own port and its own Brave profile.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { spawn } = require('child_process');

const count = Number(process.env.BOT_COUNT || 4);
const base = Number(process.env.BASE_PORT || 3001);

for (let i = 0; i < count; i++) {
  const port = base + i;
  const name = `bot-${i + 1}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(port), BOT_NAME: name },
    stdio: 'inherit',
  });
  child.on('exit', (code) => console.log(`[${name}] exited with code ${code}`));
}
console.log(`Started ${count} bots on ports ${base}-${base + count - 1}`);
