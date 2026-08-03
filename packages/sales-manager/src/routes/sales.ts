import { Hono } from 'hono';
import { importarVentasPos, vaciarVentasPos } from '../services/salesImport.service';
import {
  obtenerResumenColegios,
  obtenerResumenPeriodo,
  obtenerVentasPorPrendaYTalla,
} from '../services/salesAnalytics.service';
import { calcularProyeccionVentas } from '../services/salesProjection.service';
import { generarVentasSimuladasExcelBuffer } from '../services/salesSimulator.service';

const app = new Hono();

// /api/sales/limpiar - Vaciar base de datos de ventas (DELETE, POST, GET)
const handleLimpiar = async (c: any) => {
  try {
    await vaciarVentasPos();
    return c.json({
      success: true,
      message: 'La base de datos de ventas ha sido vaciada completamente.',
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Error al vaciar ventas' }, 500);
  }
};

app.delete('/limpiar', handleLimpiar);
app.post('/limpiar', handleLimpiar);
app.get('/limpiar', handleLimpiar);

// POST /api/sales/importar
app.post('/importar', async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body['archivo'] || body['file'];

    if (!file || !(file instanceof File)) {
      return c.json({ success: false, error: 'Se requiere un archivo .xlsx válido de ventas.' }, 400);
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const resultado = await importarVentasPos(buffer);

    return c.json({
      success: true,
      data: resultado,
      message: `Ventas importadas con éxito. Total filas insertadas: ${resultado.insertados}`,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Error al importar ventas' }, 500);
  }
});

// GET /api/sales/colegios
app.get('/colegios', async (c) => {
  try {
    const colegio = c.req.query('colegio');
    const anioStr = c.req.query('anio');
    const anio = anioStr ? parseInt(anioStr, 10) : undefined;

    const colegios = await obtenerResumenColegios(colegio, anio);
    return c.json({ success: true, data: colegios });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/sales/resumen-periodo
app.get('/resumen-periodo', async (c) => {
  try {
    const agrupacion = (c.req.query('agrupacion') as 'mensual' | 'trimestral') || 'trimestral';
    const colegio = c.req.query('colegio');
    const anioStr = c.req.query('anio');
    const anio = anioStr ? parseInt(anioStr, 10) : undefined;

    const resumen = await obtenerResumenPeriodo(agrupacion, colegio, anio);
    return c.json({ success: true, data: resumen });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/sales/ventas-prenda
app.get('/ventas-prenda', async (c) => {
  try {
    const colegio = c.req.query('colegio');
    const anioStr = c.req.query('anio');
    const trimestre = c.req.query('trimestre');
    const anio = anioStr ? parseInt(anioStr, 10) : undefined;

    const detalle = await obtenerVentasPorPrendaYTalla(colegio, anio, trimestre);
    return c.json({ success: true, data: detalle });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// POST /api/sales/proyectar
app.post('/proyectar', async (c) => {
  try {
    const body = await c.req.json();
    const colegioOrigen = body.colegioOrigen || 'Inf SM';
    const colegioDestino = body.colegioDestino || 'Cambridge';
    const anio = parseInt(body.anio, 10) || 2025;
    const trimestre = body.trimestre || undefined;
    const factorEscalaAlumnos = parseFloat(body.factorEscalaAlumnos) || 1.0;
    const factorCrecimientoPct = parseFloat(body.factorCrecimientoPct) || 0.0;
    const vendedorSimulado = body.vendedorSimulado;

    const proyeccion = await calcularProyeccionVentas(
      colegioOrigen,
      colegioDestino,
      anio,
      trimestre,
      factorEscalaAlumnos,
      factorCrecimientoPct,
      vendedorSimulado
    );

    return c.json({ success: true, data: proyeccion });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

// POST /api/sales/exportar-ventas-simuladas
app.post('/exportar-ventas-simuladas', async (c) => {
  try {
    const body = await c.req.json();
    const colegioOrigen = body.colegioOrigen || 'Inf SM';
    const colegioDestino = body.colegioDestino || 'Cambridge';
    const anio = parseInt(body.anio, 10) || 2025;
    const trimestre = body.trimestre || undefined;
    const factorEscalaAlumnos = parseFloat(body.factorEscalaAlumnos) || 1.0;
    const factorCrecimientoPct = parseFloat(body.factorCrecimientoPct) || 0.0;
    const vendedorNombre = body.vendedorNombre || 'Sara Limachi SM';
    const nPedidoInicial = parseInt(body.nPedidoInicial, 10) || 3000;
    const fechaInicioIso = body.fechaInicioIso;
    const fechaFinIso = body.fechaFinIso;

    const proyeccion = await calcularProyeccionVentas(
      colegioOrigen,
      colegioDestino,
      anio,
      trimestre,
      factorEscalaAlumnos,
      factorCrecimientoPct,
      vendedorNombre
    );

    const buffer = generarVentasSimuladasExcelBuffer(proyeccion, {
      vendedorNombre,
      nPedidoInicial,
      fechaInicioIso,
      fechaFinIso,
    });

    const nombreArchivo = `sales_export_simulado_${colegioDestino}_${vendedorNombre.replace(/\s+/g, '_')}.xlsx`;

    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    c.header('Content-Disposition', `attachment; filename="${nombreArchivo}"`);

    return c.body(Uint8Array.from(buffer));
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

export default app;
