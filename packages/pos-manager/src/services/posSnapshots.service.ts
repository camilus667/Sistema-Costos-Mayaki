import { eq, desc } from 'drizzle-orm';
import { getDb, saveDbToDisk } from '../../../api/src/database/sqljs.ts';
import { posProductos, posSnapshots } from '../../../api/src/database/schema.ts';

export interface PosSnapshotSummary {
  id: string;
  nombre: string;
  descripcion: string | null;
  totalProductos: number;
  creadoPor: string | null;
  creadoEn: string;
}

export async function crearSnapshotPos(
  nombre: string,
  descripcion?: string,
  creadoPor?: string
): Promise<PosSnapshotSummary> {
  const db = await getDb();
  const productos = db.select().from(posProductos).all();

  const datosJson = JSON.stringify(productos);

  const res = db.insert(posSnapshots)
    .values({
      nombre,
      descripcion: descripcion || null,
      datosJson,
      totalProductos: productos.length,
      creadoPor: creadoPor || 'sistema',
    })
    .returning()
    .get();

  saveDbToDisk();

  return {
    id: res.id,
    nombre: res.nombre,
    descripcion: res.descripcion,
    totalProductos: res.totalProductos,
    creadoPor: res.creadoPor,
    creadoEn: res.creadoEn,
  };
}

export async function listarSnapshotsPos(): Promise<PosSnapshotSummary[]> {
  const db = await getDb();
  const lista = db.select({
    id: posSnapshots.id,
    nombre: posSnapshots.nombre,
    descripcion: posSnapshots.descripcion,
    totalProductos: posSnapshots.totalProductos,
    creadoPor: posSnapshots.creadoPor,
    creadoEn: posSnapshots.creadoEn,
  })
    .from(posSnapshots)
    .orderBy(desc(posSnapshots.creadoEn))
    .all();

  return lista;
}

export async function restaurarSnapshotPos(id: string): Promise<{ restaurados: number }> {
  const db = await getDb();
  const snapshot = db.select().from(posSnapshots).where(eq(posSnapshots.id, id)).get();

  if (!snapshot) {
    throw new Error(`Snapshot no encontrado: id ${id}`);
  }

  const productos: any[] = JSON.parse(snapshot.datosJson);

  db.delete(posProductos).run();

  productos.forEach((p) => {
    db.insert(posProductos).values(p).run();
  });

  saveDbToDisk();

  return { restaurados: productos.length };
}

export async function eliminarSnapshotPos(id: string): Promise<{ ok: boolean }> {
  const db = await getDb();
  db.delete(posSnapshots).where(eq(posSnapshots.id, id)).run();
  saveDbToDisk();
  return { ok: true };
}
