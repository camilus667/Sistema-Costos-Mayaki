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
      const files = fs.readdirSync(dirExtractos).filter((f: string) => f.endsWith('.xls') || f.endsWith('.xlsx'));
      console.log(`📂 Se encontraron ${files.length} archivos de extractos en '${dirExtractos}'. Procesando...`);

      files.forEach((file: string) => {
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
