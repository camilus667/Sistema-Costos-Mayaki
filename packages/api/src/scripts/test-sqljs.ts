import * as SqlJs from 'sql.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function test() {
  console.log('Testing sql.js import...');
  console.log('__dirname:', __dirname);
  
  const initSqlJs: any = SqlJs.default;
  
  // El script está en packages/api/src/scripts/
  // El wasm está en packages/api/sql-wasm.wasm
  // Necesitamos subir 3 niveles: scripts -> src -> api
  const wasmDir = resolve(__dirname, '../../../..');
  console.log('WASM dir:', wasmDir);
  
  const SQL: any = await initSqlJs({
    locateFile: (filename: string) => {
      console.log('Looking for:', filename);
      const fullPath = resolve(wasmDir, filename);
      console.log('Full path:', fullPath);
      return fullPath;
    },
  });
  
  console.log('SQL type after init:', typeof SQL);
  console.log('SQL.Database exists:', typeof SQL.Database);
  
  if (typeof SQL.Database === 'function') {
    const db = new SQL.Database();
    console.log('Database created successfully!');
    db.run("CREATE TABLE test (id INT, value TEXT)");
    db.run("INSERT INTO test VALUES (1, 'hello')");
    const results = db.exec("SELECT * FROM test");
    console.log('Query results:', JSON.stringify(results, null, 2));
    console.log('SUCCESS!');
  } else {
    console.log('SQL.Database is not a constructor');
  }
}

test().catch(console.error);
