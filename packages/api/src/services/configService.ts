import { configuracionSistema } from '../database/schema';
import { eq } from 'drizzle-orm';
import { saveDbToDisk } from '../database/sqljs';

export interface SystemConfig {
  tasaIva: number; // e.g. 13  — PORCENTAJE, no fraccion. Ver tasaIvaComoFraccion.
  factorIva: number; // e.g. 1.13
  volumenMensualProduccion: number; // e.g. 1800
  mermaPorcentajeEstandar: number; // e.g. 8
  tallaDefecto: string; // e.g. '16/34'

  /**
   * FASE 3. Si los impuestos se consideran del lado del PRECIO. Default false,
   * decidido con el usuario el 28-jul-2026. Nunca afecta al costo: el costo neto
   * se calcula siempre sin IVA, porque el IVA de compras es credito fiscal
   * recuperable.
   */
  impuestosActivos: boolean;

  /**
   * FASE 3. Descuento sobre el precio de lista cuando la venta va SIN factura.
   * 0.10 en Cambridge. Los precios de `precio_venta` son precios CON factura.
   */
  descuentoSinFactura: number;
}

export async function getSystemConfig(db: any): Promise<SystemConfig> {
  let list: any[] = [];
  try {
    list = await db.select().from(configuracionSistema);
  } catch (e) {
    console.error('Error fetching configuracionSistema:', e);
  }

  const map = new Map<string, string>();
  list.forEach((item: any) => map.set(item.clave, item.valor));

  const tasaIva = map.has('tasa_iva') ? (Number(map.get('tasa_iva')) || 0) : 13;
  const volumenMensualProduccion = map.has('volumen_mensual_produccion') ? (Number(map.get('volumen_mensual_produccion')) || 0) : 1800;
  const mermaPorcentajeEstandar = map.has('merma_porcentaje_estandar') ? (Number(map.get('merma_porcentaje_estandar')) || 0) : 8;
  const tallaDefecto = map.has('talla_defecto') ? (map.get('talla_defecto') || '16/34').trim() : '16/34';

  // Default OFF, decidido con el usuario. Solo se activa con la cadena 'true'
  // exacta, asi que cualquier valor raro en la base deja los impuestos apagados,
  // que es el lado conservador.
  const impuestosActivos = map.has('impuestos_activos')
    ? String(map.get('impuestos_activos')).trim().toLowerCase() === 'true'
    : false;

  const descuentoSinFactura = map.has('descuento_sin_factura')
    ? (Number(map.get('descuento_sin_factura')) || 0)
    : 0.1;

  return {
    tasaIva,
    factorIva: 1 + (tasaIva / 100),
    volumenMensualProduccion,
    mermaPorcentajeEstandar,
    tallaDefecto,
    impuestosActivos,
    descuentoSinFactura,
  };
}

export async function setSystemConfig(db: any, clave: string, valor: string, descripcion?: string) {
  const existing = await db.select().from(configuracionSistema).where(eq(configuracionSistema.clave, clave)).limit(1);
  if (existing && existing.length > 0) {
    await db.update(configuracionSistema).set({
      valor: String(valor).trim(),
      ...(descripcion ? { descripcion } : {}),
      actualizadoEn: new Date().toISOString(),
    }).where(eq(configuracionSistema.clave, clave));
  } else {
    await db.insert(configuracionSistema).values({
      clave,
      valor: String(valor).trim(),
      descripcion: descripcion || '',
    });
  }
  saveDbToDisk();
}
