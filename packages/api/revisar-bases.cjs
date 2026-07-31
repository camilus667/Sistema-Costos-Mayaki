const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

(async () => {
  const SQL = await initSqlJs({
    locateFile: () => path.join(process.cwd(), "sql-wasm.wasm"),
  });
  const archivos = fs.readdirSync(".").filter(f => f.endsWith(".db") || f.endsWith(".bak"));

  for (const f of archivos) {
    const bytes = fs.readFileSync(f);
    let linea = f.padEnd(58) + String(Math.round(bytes.length / 1024)).padStart(6) + " KB  ";
    try {
      const db = new SQL.Database(bytes);
      const q = (sql) => {
        try { const r = db.exec(sql); return r.length ? r[0].values[0][0] : 0; }
        catch (e) { return "-"; }
      };
      linea += "colegios " + String(q("select count(*) from colegio")).padStart(3)
            + " | prendas " + String(q("select count(*) from producto")).padStart(4)
            + " | tallas " + String(q("select count(*) from talla")).padStart(3)
            + " | precios " + String(q("select count(*) from precio_venta")).padStart(5)
            + " | codigos POS " + String(q("select count(*) from precio_venta where codigo_externo is not null and codigo_externo <> ''")).padStart(5)
            + " | inventario " + String(q("select count(*) from inventario")).padStart(5)
            + " | stock " + String(q("select coalesce(sum(cantidad),0) from inventario")).padStart(7);
      db.close();
    } catch (e) {
      linea += "NO SE PUDO ABRIR: " + e.message;
    }
    console.log(linea);
  }
})();
