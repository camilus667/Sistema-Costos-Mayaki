import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import bankRoutes from './routes/bank';
import path from 'path';
import fs from 'fs';
import { parsearExtractoBancarioBuffer } from './services/bankParser.service';
import { guardarMovimientos, vaciarMovimientos } from './services/bankAnalytics.service';

const app = new Hono();

// Servir archivos estáticos del dashboard
app.use('/*', serveStatic({ root: './src/public' }));

// Montar rutas API de extractos bancarios
app.route('/api/bank', bankRoutes);

// Auto-cargar extractos desde _extractos en arranque inicial
function autocargarExtractos() {
  try {
    vaciarMovimientos();
    const posiblesRutas = [
      path.resolve(process.cwd(), '_extractos'),
      path.resolve(process.cwd(), '../../_extractos'),
      'd:\\DOCUMENTOS\\Contabilidad\\Documentacion MAYAKI\\Documentos Credito FIE\\Inventario\\SISTEMA INVENTARIO\\_extractos',
    ];

    let dirExtractos = '';
    for (const r of posiblesRutas) {
      if (fs.existsSync(r)) {
        dirExtractos = r;
        break;
      }
    }

    if (dirExtractos) {
      const archivosDeseados = [
        'banco BISA ExtractoDeMovimientos_1785873392607.xls',
        'bnb 2025-2026.xls',
        'Extracto_Banco Union_2.xls',
      ];

      const todosArchivos = fs.readdirSync(dirExtractos);
      const files = archivosDeseados.filter((f) => todosArchivos.includes(f));
      const otrosArchivos = todosArchivos.filter(
        (f) => (f.endsWith('.xls') || f.endsWith('.xlsx')) && !archivosDeseados.includes(f) && !f.startsWith('12.0')
      );
      const listaProcesar = files.length > 0 ? files : otrosArchivos;

      console.log(`📂 Se procesarán ${listaProcesar.length} archivos de extractos por defecto desde '${dirExtractos}'...`);

      listaProcesar.forEach((file: string) => {
        const filePath = path.join(dirExtractos, file);
        try {
          const buf = fs.readFileSync(filePath);
          const resImport = parsearExtractoBancarioBuffer(buf, file);
          if (resImport.totalTransacciones > 0) {
            guardarMovimientos(resImport.movimientos, true);
            console.log(`  ✅ Extracto auto-cargado: ${file} (${resImport.bancoDetectado} - ${resImport.totalTransacciones} movs)`);
          }
        } catch (e: any) {
          console.error(`  ❌ Error al auto-cargar ${file}:`, e.message);
        }
      });
    } else {
      console.warn('⚠️ No se encontró la carpeta _extractos en ninguna de las rutas posibles.');
    }
  } catch (e: any) {
    console.warn('Advertencia al autocargar extractos:', e.message);
  }
}

// Ejecutar autocarga
autocargarExtractos();

export default app;
