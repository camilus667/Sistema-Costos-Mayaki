const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Limpiar lockfile viejo al arrancar
const lockFile = path.resolve(__dirname, '../packages/api/sistema_inventario.db.lock');
if (fs.existsSync(lockFile)) {
  try { fs.unlinkSync(lockFile); } catch (e) {}
}

console.log('🚀 Iniciando todos los servidores en paralelo...\n');

function runService(name, color, cmd, args, cwd) {
  const child = spawn(cmd, args, {
    cwd: path.resolve(__dirname, '..', cwd),
    stdio: 'pipe',
    shell: true,
  });

  child.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      if (line) console.log(`[${name}] ${line}`);
    });
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      if (line) console.error(`[${name} ERR] ${line}`);
    });
  });

  child.on('close', (code) => {
    console.log(`[${name}] proceso finalizado con código ${code}`);
  });

  return child;
}

// 1. API Backend (3000)
runService('API-3000', '\x1b[36m', 'npx', ['tsx', 'watch', 'src/server.ts'], 'packages/api');

// 2. POS Manager (3001)
runService('POS-3001', '\x1b[33m', 'npx', ['tsx', 'watch', 'src/server.ts'], 'packages/pos-manager');

// 3. Sales Manager (3002)
runService('SALES-3002', '\x1b[35m', 'npx', ['tsx', 'watch', 'src/server.ts'], 'packages/sales-manager');

// 4. Bank Analyzer (3003)
runService('BANK-3003', '\x1b[32m', 'npx', ['tsx', 'watch', 'src/server.ts'], 'packages/bank-analyzer');
