const { spawn } = require('child_process');
const electron = require('electron');

// Some shells export this flag for Electron's Node integration. Electron then
// launches main.js as a Node program instead of opening the desktop app.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit'
});

child.on('error', (error) => {
  console.error(`Unable to launch Electron: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code) => process.exit(code ?? 0));
