import { configuracionSistema } from '../database/schema';
import { eq } from 'drizzle-orm';
import { saveDbToDisk } from '../database/sqljs';

export interface SystemConfig {
  tasaIva: number; // e.g. 13
  factorIva: number; // e.g. 1.13
  volumenMensualProduccion: number; // e.g. 1800
  mermaPorcentajeEstandar: number; // e.g. 8
  tallaDefecto: string; // e.g. '16/34'
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

  return {
    tasaIva,
    factorIva: 1 + (tasaIva / 100),
    volumenMensualProduccion,
    mermaPorcentajeEstandar,
    tallaDefecto,
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
