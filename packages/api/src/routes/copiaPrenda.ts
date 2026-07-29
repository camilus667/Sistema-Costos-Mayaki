/**
 * Copiar los datos de costeo de una prenda de referencia — /api/productos
 *
 * POST /api/productos/:productoId/copiar-de/:origenId
 *
 * Existe como archivo aparte y no dentro de detalleAccesorio.ts porque ya no es una
 * operacion sobre la receta: toca producto (factor y tela), peso_mat_prima, mano_obra y
 * detalle_acc. Meterlo ahi habria hecho que un modulo llamado "detalle de accesorios"
 * escribiera cuatro tablas, y despues nadie sabe donde buscar.
 *
 * Se monta en el mismo prefijo /api/productos que producto.ts y detalleAccesorio.ts, que
 * es un patron que este proyecto ya usa (ver server.ts).
 *
 * LA LOGICA NO ESTA ACA: esta en services/copiarPrenda.service.ts. El endpoint valida la
 * entrada y traduce el resultado a HTTP, nada mas. Es la misma separacion que el motor de
 * costeo, y por la misma razon: el dia que esto se necesite desde un script de alta
 * masiva, la logica se llama sin levantar un servidor.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { copiarPrendaDeReferencia } from '../services/copiarPrenda.service';
import { saveDbToDisk } from '../database/sqljs';

const api = new Hono();

const queCopiarSchema = z.object({
  receta: z.boolean().optional().default(true),
  pesos: z.boolean().optional().default(true),
  manoObra: z.boolean().optional().default(true),
  factor: z.boolean().optional().default(true),
  tela: z.boolean().optional().default(false),
  /**
   * Sobreescribe lo que la prenda destino ya tenga. Sin esto solo se llena lo vacio.
   *
   * El default es false a proposito: copiar no debe destruir trabajo humano por descuido.
   * Quien quiere realinear una prenda ya cargada con su referencia lo pide explicito.
   */
  reemplazar: z.boolean().optional().default(false),
});

api.post('/:productoId/copiar-de/:origenId', zValidator('json', queCopiarSchema), async (c) => {
  const db = (c as any).db;
  const productoId = c.req.param('productoId');
  const origenId = c.req.param('origenId');
  const que = c.req.valid('json');

  // Pedir una copia sin marcar nada no es un error del sistema, es un pedido vacio: se
  // dice, en vez de responder success sobre cero trabajo.
  if (!que.receta && !que.pesos && !que.manoObra && !que.factor && !que.tela) {
    return c.json({
      success: false,
      error: 'No se marco nada para copiar. Elegí al menos uno: receta, pesos, mano de obra, factor o tela.',
    }, 400);
  }

  const r = await copiarPrendaDeReferencia(db, productoId, origenId, que);

  if (!r.ok) {
    return c.json({ success: false, error: r.error }, r.estado as any);
  }

  saveDbToDisk();

  return c.json({ success: true, ...r.resumen }, 201);
});

export default api;
