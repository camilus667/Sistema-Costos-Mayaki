/**
 * Servidor local de desarrollo
 * Usa sql.js para la base en memoria, cargada desde el archivo del proyecto.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, saveDbToDisk, schema } from './database/sqljs';
import colegioRoutes from './routes/colegio';
import usuarioRoutes from './routes/usuario';
import productoRoutes from './routes/producto';
import tallaRoutes from './routes/talla';
import telaRoutes from './routes/tela';
import accesorioRoutes from './routes/accesorio';
import detalleAccesorioRoutes from './routes/detalleAccesorio';
import copiaPrendaRoutes from './routes/copiaPrenda';
import calculoRoutes from './routes/calculo';
// El orden de las prendas y su referencia salen de las mismas casas que usan las matrices, para
// que las dos pantallas no puedan discrepar.
import { ordenarPrendasDesdeBase } from './services/ordenPrendasDb';
import { referenciasDesdeBase } from './services/referenciaPrendaDb';
import inventarioRoutes from './routes/inventario';
import precioRoutes from './routes/precio';
import exportRoutes from './routes/export';
import inputRoutes from './routes/inputs';
import costeoRoutes from './routes/costeo';
import snapshotRoutes from './routes/snapshots';
import importarRoutes from './routes/importar';
import { asc, eq } from 'drizzle-orm';
import { costearLote } from './services/calculo/costeoInputs.service';
import {
  construirContextoFiscal,
  resolverPrecios,
  etiquetaModalidad,
} from './services/modalidadFiscal';

const app = new Hono();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dashboardHtmlPath = path.join(__dirname, 'dashboard.html');

const getDashboardHtml = async () => {
  const fs = await import('fs/promises');
  return await fs.readFile(dashboardHtmlPath, 'utf8');
};

// Servir cualquier archivo estático alojado en packages/api/src/public/ (favicon.ico, favicon.png, favicon.svg, styles.css, etc.)
app.use('/*', async (c, next) => {
  const reqPath = c.req.path;
  if (reqPath === '/' || reqPath === '/dashboard' || reqPath.startsWith('/api')) {
    return next();
  }

  const publicDir = path.join(__dirname, 'public');
  const fileName = reqPath.replace(/^\//, '');
  const filePath = path.join(publicDir, fileName);

  try {
    const fs = await import('fs/promises');
    const stat = await fs.stat(filePath);
    if (stat.isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentTypes: Record<string, string> = {
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.js': 'text/javascript',
        '.json': 'application/json'
      };
      const contentType = contentTypes[ext] || 'application/octet-stream';
      const data = await fs.readFile(filePath);
      c.header('Content-Type', contentType);
      c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      return c.body(data);
    }
  } catch (err) {
    // Si no existe favicon específico pero piden favicon.ico, intentar servir favicon.svg o favicon.png
    if (reqPath === '/favicon.ico' || reqPath === '/favicon.png') {
      try {
        const fs = await import('fs/promises');
        const svgPath = path.join(publicDir, 'favicon.svg');
        const data = await fs.readFile(svgPath);
        c.header('Content-Type', 'image/svg+xml');
        c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        return c.body(data);
      } catch (e) {}
    }
  }
  return next();
});

// Dashboard HTML en la raíz y /dashboard
app.get('/', async (c) => {
  try {
    const html = await getDashboardHtml();
    return c.html(html);
  } catch (err) {
    return c.text('Error al cargar dashboard HTML: ' + String(err), 500);
  }
});

app.get('/dashboard', async (c) => {
  try {
    const html = await getDashboardHtml();
    return c.html(html);
  } catch (err) {
    return c.text('Error al cargar dashboard HTML: ' + String(err), 500);
  }
});

// Middlewares
app.use('*', logger());
app.use('*', prettyJSON());
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

// Health check
app.get('/health', async (c) => {
  try {
    await getDb();
    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'sql-js-local',
      origenDatos: 'archivo de base de datos del proyecto'
    });
  } catch (error) {
    return c.json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: String(error)
    }, 500);
  }
});

// Database init middleware - inyecta DB en el context, y persiste al salir.
//
// PERSISTENCIA AUTOMATICA. sql.js vive en memoria: una escritura solo llega al
// disco cuando alguien llama saveDbToDisk(). Ese "alguien" era cada handler, a
// mano, y la mitad no lo hacia. Escribian en memoria, devolvian 200, y el dato se
// perdia al reiniciar el proceso:
//
//   PUT /api/calculo/precio-venta              <- el precio de venta
//   PUT /api/inputs/tabla-auxiliar-accesorios/:id  <- el costo del accesorio
//   POST, PUT y DELETE de tela, talla y accesorio
//   POST, PUT, DELETE y PATCH de colegio
//
// Peor que perderse siempre: se perdia a veces. saveDbToDisk() vuelca la base
// entera, asi que si despues de editar un precio el usuario tocaba el inventario
// —que si guardaba— el precio se persistia de rebote. El mismo gesto se guardaba
// o se perdia segun lo que el usuario hiciera despues.
//
// Es la tercera vez en el refactor que aparece este patron (antes: mano_obra
// resembrada en cada arranque, y el PUT de mano de obra que respondia OK y
// desaparecia). Sembrar dieciseis llamadas mas seria repetir la causa. El flush
// vive en UN lugar, corre despues del handler, solo en escrituras que salieron
// bien, y no se puede olvidar.
//
// Esto es especifico del entrypoint local. index.ts usa D1, donde la escritura ya
// es durable y no hay nada que volcar.
app.use('/api/*', async (c, next) => {
  const db = await getDb();
  (c as any).db = db;
  (c as any).schema = schema;

  await next();

  const metodo = c.req.method;
  const esEscritura = metodo !== 'GET' && metodo !== 'HEAD' && metodo !== 'OPTIONS';

  // UNA RUTA PUEDE DECLARAR QUE NO ESCRIBIO, y entonces no se vuelca nada.
  //
  // Hace falta porque "es POST" no es lo mismo que "escribio". /api/importar/preview es un
  // POST —recibe un .xlsx de 157 KB por multipart— y su promesa central es no tocar la
  // base. El middleware la volcaba igual, y aunque el contenido logico no cambiaba, el
  // archivo SI: sql.js re-serializa y los bytes salen distintos.
  //
  // Lo encontro la verificacion de punta a punta del importador, que compara el archivo byte
  // a byte antes y despues del preview. Y solo aparecio DESPUES de sacar el sembrado del
  // arranque: antes el arranque ya reescribia el archivo, asi que el volcado del middleware
  // producia los mismos bytes y el defecto quedaba tapado. Un cambio destapo al otro.
  //
  // Ademas es puro desperdicio: volcar un MB de base tras una operacion de solo lectura.
  const declaroNoEscribir = (c as any).__noEscribio === true;
  if (esEscritura && !declaroNoEscribir && c.res.status < 400) {
    saveDbToDisk();
  }
});

// API resumen dashboard avanzado con KPIs financieros completos de prendas, precios y costos
//
// EL COSTO SALE DEL MOTOR. Antes salia del cache de CAMBRIDGE.xlsx:
//
//   const ct = excelData ? (excelData.costoTotal.get(key) || 0) : 0;
//
// con key = `${itemNumero}_${tallaCodigo}`. Para una prenda de un colegio que no tiene
// hoja en ese workbook, esa busqueda devolvia undefined y el costo quedaba en CERO.
//
// Lo delator era que el precio y el stock SI aparecian: los dos PUT de la matriz
// escriben en ese mismo Map, asi que quedaban cargados. La pantalla mostraba
// "Venta Total Proyectada 8.160" con "Inversion Total 0,00" y una ganancia del 100%.
//
// Este era el QUINTO consumidor de la formula de costeo y estaba en server.ts, no en
// routes/. Todas las auditorias de la Fase 2 buscaron copias en routes/ y midieron TRES
// bandas nombradas; esta nunca declaro huella y nunca se comparo. La afirmacion "una
// sola formula" era cierta para lo medido y falsa para lo que no se miro.
app.get('/api/dashboard-resumen', async (c) => {
  const db = await getDb();
  const colegioIdRaw = c.req.query('colegioId');
  const colegioId = colegioIdRaw && colegioIdRaw !== 'all' ? colegioIdRaw : undefined;
  const snapshotId = c.req.query('snapshotId');

  // El encabezado tiene que mostrar el colegio ELEGIDO, no el primero de la tabla.
  // Con dos colegios, `limit(1)` mostraba siempre el mismo nombre.
  //
  // Y SIN COLEGIO NO HAY COLEGIO QUE DEVOLVER. El `else` de esta expresion seguia
  // haciendo `limit(1)` cuando el ambito era TODA LA EMPRESA, asi que la respuesta
  // afirmaba "Col. Cambridge" sobre un conjunto de datos que abarca los dos
  // colegios. La pantalla no lo mostraba y el defecto quedo invisible hasta que el
  // reporte en PDF empezo a imprimir ese campo como subtitulo: una hoja que se
  // entrega, con las cifras de toda la empresa y el nombre de un solo colegio.
  //
  // Devolver null es la respuesta honesta. `ambito` da el rotulo ya resuelto para
  // quien solo quiera mostrarlo.
  const colegio = colegioId
    ? (await db.select().from(schema.colegios).where(eq(schema.colegios.id, colegioId)).limit(1))[0]
    : undefined;
  const totalColegios = (await db.select().from(schema.colegios)).length;

  const anio = (await db.select().from(schema.aniosEscolares).limit(1))[0];
  const admin = (await db.select().from(schema.usuarios).limit(1))[0];
  const tallas = await db.select().from(schema.tallas).orderBy(asc(schema.tallas.orden));

  let prodQuery = db.select().from(schema.productos);
  if (colegioId) prodQuery = prodQuery.where(eq(schema.productos.colegioId, colegioId));
  const productosSinOrdenar = await prodQuery
    .orderBy(asc(schema.productos.orden), asc(schema.productos.itemNumero));

  // EL ORDEN LO DEFINE LA MISMA CASA QUE EL DE LAS MATRICES: `services/ordenPrendas.ts`.
  //
  // Este `orderBy` de SQL ordenaba por `orden, itemNumero` sin conocer los colegios, asi que
  // Resumen General y Matrices Consolidadas mostraban las prendas en ORDEN DISTINTO. Con dos
  // colegios eso se nota enseguida: la matriz las agrupa por colegio y el resumen las intercalaba.
  //
  // El `orderBy` se conserva para que el resultado sea ESTABLE antes de ordenar —dos filas
  // empatadas no pueden venir en distinto orden entre dos llamadas—, pero el criterio real se
  // aplica despues, igual que en `/api/productos`.
  const productos = await ordenarPrendasDesdeBase(db, productosSinOrdenar as any, 'defecto', {
    agruparPorColegio: !colegioId,
  });

  // La REFERENCIA `CC-01` de cada prenda, que es lo que va en la columna `Prod`. Sin esto el
  // resumen caia al numero de item y mostraba codigos distintos que la matriz para la misma prenda.
  const referencias = await referenciasDesdeBase(db);

  const telas = await db.select().from(schema.telas);
  const accesorios = await db.select().from(schema.accesorios);

  // Costeo y precios: del motor, la misma fuente que las matrices.
  const { filas, ctx } = await costearLote(db, { colegioId, snapshotId });

  // Tasas reales de la configuración para calcular ambos canales.
  // Se calcula aquí directamente para no depender de si el motor tenía
  // impuestosActivos=true o false al momento de correr.
  const avisosFiscales: string[] = [];
  const fiscal = construirContextoFiscal(c, ctx, avisosFiscales);

  // DOS PRECIOS Y NO UNO. Antes esta pantalla guardaba un solo campo `precio` que
  // era el ingreso NETO, y lo mostraba como si fuera el precio de venta. Por eso
  // con factura aparecia 87 donde el precio de lista dice 100.
  //
  //   precio       lo que se le cobra al cliente   -> columna "Precio" y valorizacion
  //   ingresoNeto  lo que queda tras el IVA        -> margen y ganancia
  //
  // Con factura difieren en el debito fiscal; sin factura son el mismo numero.
  const costeo = new Map<
    string,
    { costo: number; precio: number; ingresoNeto: number; margenPct: number }
  >();
  for (const f of filas) {
    const costoNeto = Number(f.resultado.costoUnitarioNeto) || 0;
    const { precioVenta, ingresoNeto } = resolverPrecios(f.meta.precioVentaBs, fiscal);

    // El margen se mide contra el ingreso efectivamente cobrado, no contra el
    // precio de lista: es la regla que ya aplica costoTotal.service.ts y que
    // existe para no reportar como ganancia plata que nunca entra al bolsillo.
    const margenPct =
      ingresoNeto > 0 ? ((ingresoNeto - costoNeto) / ingresoNeto) * 100 : 0;

    costeo.set(`${f.meta.productoId}_${f.meta.tallaId}`, {
      costo: costoNeto,
      precio: precioVenta,
      ingresoNeto,
      margenPct,
    });
  }

  // Stock: de la tabla, que es su fuente de verdad.
  const invList = await db.select().from(schema.inventario);
  const stockPorClave = new Map<string, number>();
  for (const i of invList) {
    stockPorClave.set(`${i.productoId}_${i.tallaId}`, Number(i.cantidad) || 0);
  }

  let totalStockUnidades = 0;
  let totalValorCostoBs = 0;
  let totalValorVentaBs = 0;
  let totalIngresoNetoBs = 0;

  const resumenPrendas = productos.map((p: any) => {
    let prodStock = 0;
    let prodCostoBs = 0;
    let prodVentaBs = 0;
    let prodIngresoNetoBs = 0;

    let minCosto = Infinity;
    let maxCosto = 0;
    let minPrecio = Infinity;
    let maxPrecio = 0;
    const margenes: number[] = [];

    tallas.forEach((t: any) => {
      const clave = `${p.id}_${t.id}`;
      const c2 = costeo.get(clave);
      if (!c2) return;

      const ct = c2.costo;
      const pv = c2.precio;
      const inNeto = c2.ingresoNeto;
      const mg = c2.margenPct;
      const inv = stockPorClave.get(clave) || 0;

      if (ct > 0) {
        if (ct < minCosto) minCosto = ct;
        if (ct > maxCosto) maxCosto = ct;
      }
      if (pv > 0) {
        if (pv < minPrecio) minPrecio = pv;
        if (pv > maxPrecio) maxPrecio = pv;
        // El margen sobre venta se promedia solo donde hay precio Y costo: con costo 0
        // el margen sale 100% y ensucia el promedio sin informar nada.
        if (ct > 0) margenes.push(mg);
      }

      prodStock += inv;
      prodCostoBs += inv * ct;
      // Sin precio de venta se valoriza al costo, igual que antes.
      prodVentaBs += inv * (pv > 0 ? pv : ct);
      prodIngresoNetoBs += inv * (inNeto > 0 ? inNeto : ct);
    });

    totalStockUnidades += prodStock;
    totalValorCostoBs += prodCostoBs;
    totalValorVentaBs += prodVentaBs;
    totalIngresoNetoBs += prodIngresoNetoBs;

    // La ganancia sale del ingreso NETO, no del precio facturado. Con factura los
    // dos difieren en el debito fiscal, y contarlo como ganancia seria contar como
    // propia una plata que se le debe al fisco.
    const gananciaBs = prodIngresoNetoBs - prodCostoBs;
    const margenPct = margenes.length > 0
      ? margenes.reduce((a, b) => a + b, 0) / margenes.length
      : 0;

    return {
      id: p.id,
      itemNumero: p.itemNumero,
      prod: referencias.get(String(p.id)) ?? null,
      descripcion: p.descripcion,
      stockTotal: prodStock,
      costoMin: minCosto !== Infinity ? parseFloat(minCosto.toFixed(2)) : 0,
      costoMax: maxCosto > 0 ? parseFloat(maxCosto.toFixed(2)) : 0,
      precioMin: minPrecio !== Infinity ? parseFloat(minPrecio.toFixed(2)) : 0,
      precioMax: maxPrecio > 0 ? parseFloat(maxPrecio.toFixed(2)) : 0,
      valorCostoTotalBs: parseFloat(prodCostoBs.toFixed(2)),
      valorVentaTotalBs: parseFloat(prodVentaBs.toFixed(2)),
      ingresoNetoTotalBs: parseFloat(prodIngresoNetoBs.toFixed(2)),
      gananciaEstimadaBs: parseFloat(gananciaBs.toFixed(2)),
      margenPromedioPct: parseFloat(margenPct.toFixed(2)),
      // Si el motor no pudo costear ninguna talla, la fila lo dice en vez de mostrar 0.
      sinCosteo: maxCosto === 0,
    };
  });

  const gananciaTotalBs = totalIngresoNetoBs - totalValorCostoBs;
  const margenPromedioGlobalPct = totalValorCostoBs > 0 ? (gananciaTotalBs / totalValorCostoBs) * 100 : 0;
  // Lo que se factura menos lo que queda: con factura es el debito fiscal, sin
  // factura es exactamente 0. Se expone para que la pantalla pueda explicar por
  // que "Venta - Inversion" no da "Ganancia" en vez de que parezca un error.
  const ivaDebitoTotalBs = totalValorVentaBs - totalIngresoNetoBs;

  const sinCosteo = resumenPrendas.filter((p: any) => p.sinCosteo).map((p: any) => p.itemNumero);

  return c.json({
    success: true,
    colegio: colegio?.nombre ?? null,
    ambito: colegio?.nombre ?? 'Toda la empresa',
    colegiosIncluidos: colegioId ? 1 : totalColegios,
    anio: anio?.anio || '2026',
    admin: admin?.email || '',
    tallasCount: tallas.length,
    productosCount: productos.length,
    variacionesCount: productos.length * tallas.length,
    telasCount: telas.length,
    accesoriosCount: accesorios.length,
    // KPIs Financieros Clave
    totalStockUnidades,
    totalValorCostoBs: parseFloat(totalValorCostoBs.toFixed(2)),
    totalValorVentaBs: parseFloat(totalValorVentaBs.toFixed(2)),
    totalIngresoNetoBs: parseFloat(totalIngresoNetoBs.toFixed(2)),
    ivaDebitoTotalBs: parseFloat(ivaDebitoTotalBs.toFixed(2)),
    gananciaTotalBs: parseFloat(gananciaTotalBs.toFixed(2)),
    margenPromedioGlobalPct: parseFloat(margenPromedioGlobalPct.toFixed(2)),
    // Modo fiscal con el que se calculo esta respuesta. Huella, igual que
    // `fuenteCosto`: si la pantalla muestra un modo y el backend calculo el otro,
    // este campo lo delata en vez de que la diferencia pase inadvertida.
    modalidad: fiscal.modalidad,
    modalidadEtiqueta: etiquetaModalidad(fiscal.modalidad),
    descuentoSinFacturaPct: parseFloat((fiscal.descuentoFraccion * 100).toFixed(2)),
    tasaIvaPct: parseFloat((fiscal.tasaIvaFraccion * 100).toFixed(2)),
    impuestosActivos: fiscal.impuestosActivos,
    // Lista de Prendas con Resumen Financiero
    prendas: resumenPrendas,
    // Huella, como las tres bandas de la reja. Si esta pantalla vuelve a leer del Excel,
    // este campo lo delata.
    fuenteCosto: 'motor-de-costeo',
    avisos: [
      ...avisosFiscales,
      ...(sinCosteo.length > 0
        ? [`Sin costeo en ninguna talla: item(s) ${sinCosteo.join(', ')}. Revisar tela vinculada, peso de materia prima y mano de obra.`]
        : []),
    ],
  });
});

// Routes
app.route('/api/colegios', colegioRoutes);
app.route('/api/usuarios', usuarioRoutes);
app.route('/api/productos', productoRoutes);
// Receta de accesorios de cada prenda. Se monta en el mismo prefijo que
// productoRoutes porque las rutas son /:productoId/accesorios, que no colisiona
// con el /:id de productoRoutes (distinta cantidad de segmentos).
app.route('/api/productos', detalleAccesorioRoutes);
// Copiar los datos de costeo de una prenda de referencia: factor, tela, pesos, mano de
// obra y receta. Tercer router en el mismo prefijo, patron que este proyecto ya usa.
app.route('/api/productos', copiaPrendaRoutes);
app.route('/api/tallas', tallaRoutes);
app.route('/api/telas', telaRoutes);
app.route('/api/accesorios', accesorioRoutes);
app.route('/api/calculo', calculoRoutes);
app.route('/api/inventario', inventarioRoutes);
app.route('/api/precios', precioRoutes);
app.route('/api/export', exportRoutes);
app.route('/api/inputs', inputRoutes);
// Costeo unificado. Se monta AL LADO de /api/inputs y /api/calculo, sin
// reemplazar nada, para poder comparar paridad antes de tocar esas pantallas.
app.route('/api/costeo', costeoRoutes);
app.route('/api/snapshots', snapshotRoutes);
app.route('/api/importar', importarRoutes);

// Iniciar servidor si se ejecuta directamente
async function start() {
  // El puerto sale del entorno y cae en 3000, que es lo que uso el proyecto siempre.
  // Estaba escrito a mano, y eso impedia levantar una segunda instancia: el script de
  // verificacion del importador necesita una apuntada a una COPIA de la base, en su propio
  // puerto, para no depender de la que ya este corriendo ni escribir en la base real.
  const PORT = Number(process.env.PORT) || 3000;

  console.log(`🚀 Iniciando servidor local en http://localhost:${PORT}`);
  console.log('📊 Base de datos: sql.js, cargada desde el archivo del proyecto');
  console.log(`🔗 Dashboard UI: http://localhost:${PORT}/`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 API base: http://localhost:${PORT}/api/`);

  await getDb();
  // MEDIDO el 31-jul-2026: con CAMBRIDGE.xlsx ausente por completo, las diez sondas de
  // lineaBase.ts devuelven exactamente lo mismo. El arranque ya no siembra ni lee el Excel,
  // asi que decir "poblada desde CAMBRIDGE.xlsx" era afirmar algo falso en cada arranque.
  console.log('✅ Base de datos lista. No se sembro nada: los datos definitivos estan en la base.');

  const { serve } = await import('@hono/node-server');

  serve(
    {
      fetch: app.fetch.bind(app),
      port: PORT,
    },
    () => {
      console.log(`✅ Servidor escuchando en puerto ${PORT}`);
    }
  );
}

const meta = import.meta as any;
if (meta.main || process.argv[1]?.includes('server.ts')) {
  start().catch(console.error);
}

export default app;
