/**
 * Copiar datos de costeo de una prenda de referencia a otra.
 *
 * POR QUE EXISTE, y por que es mas que "copiar la receta". Al dar de alta una prenda,
 * POST /:id/prendas crea sus 16 filas de peso EN CERO y ninguna de mano de obra. Con
 * peso 0 el costo de tela es 0, y sin mano de obra ese componente tambien es 0. Asi que
 * una prenda nueva con la receta copiada seguia costeando casi nada: el usuario copiaba
 * la receta, veia el costo en cero, y no tenia forma de saber que le faltaban dos
 * componentes mas.
 *
 * Los cuatro conceptos que se pueden copiar, y por que cada uno:
 *
 *   receta     detalle_acc. Lo que ya se copiaba.
 *   pesos      peso_mat_prima, por talla. Es el consumo del patron: dos prendas de la
 *              misma tela y construccion parecida tienen pesos cercanos pero no iguales,
 *              porque dependen del corte y del escalado. Un peso copiado se equivoca en
 *              un 5%; el cero de hoy se equivoca en un 100%.
 *   manoObra   mano_obra, por talla.
 *   factor     producto.factor_complejidad. Es el mas seguro de los cuatro: es una
 *              CLASIFICACION, no una medicion, y en la Fase 4 se probo que su valor
 *              absoluto no importa —escalar todos los factores por k deja la absorcion
 *              identica— solo su proporcion respecto a los demas. Copiarlo de una prenda
 *              equivalente pone a la nueva en la posicion relativa correcta.
 *   tela       producto.tela_id. Se ofrece porque SIN TELA los pesos no sirven: el costo
 *              de tela es peso x precio por gramo, y sin tela vinculada ese precio no
 *              existe. Copiar pesos sin tela deja el costo en cero igual, y eso seria
 *              repetir el problema con un paso mas.
 *
 * EL RIESGO QUE ESTO INTRODUCE, dicho de frente. Un dato copiado es plausible, y un
 * numero plausible que nadie revisa es mas peligroso que un cero que grita. Es el mismo
 * filo de la "Tasa Promedio 0.148" que se saco del dashboard hoy.
 *
 * La diferencia que lo hace aceptable: el 0.148 era inventado de la nada e irrevisable.
 * Un dato copiado es TRAZABLE — se sabe de que prenda salio. Por eso esta funcion
 * devuelve el detalle de todo lo que copio, con los valores, para que quede registro de
 * que es provisional y de donde vino.
 *
 * REEMPLAZAR o no, que es la decision mas importante de la firma:
 *   sin reemplazar  solo se llena lo que esta VACIO. Un peso ya cargado no se toca, un
 *                   factor distinto de 1 no se toca, una linea de receta existente no se
 *                   duplica. Copiar no debe destruir trabajo humano.
 *   con reemplazar  se sobreescribe. Es lo que hace falta cuando la prenda ya se creo y
 *                   se quiere realinearla con su referencia.
 */

import { and, eq } from 'drizzle-orm';
import {
  productos,
  tallas,
  accesorios,
  detalleAccesorio,
  pesoMateriaPrima,
  manoObra,
} from '../database/schema';
import { nuevoIdHex } from './resolucion.service';

export type QueCopiar = {
  receta?: boolean;
  pesos?: boolean;
  manoObra?: boolean;
  factor?: boolean;
  tela?: boolean;
  /** Sobreescribe lo que ya tenga la prenda destino. Sin esto, solo llena lo vacio. */
  reemplazar?: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Un accesorio exclusivo de un colegio no puede viajar a una prenda de otro. */
function accesorioUsable(colegioAccesorio: string | null, colegioProducto: string): boolean {
  if (!colegioAccesorio) return true;
  return colegioAccesorio === colegioProducto;
}

export async function copiarPrendaDeReferencia(
  db: any,
  productoId: string,
  origenId: string,
  que: QueCopiar
) {
  const reemplazar = !!que.reemplazar;

  const [destino] = await db.select().from(productos).where(eq(productos.id, productoId)).limit(1);
  if (!destino) return { ok: false as const, estado: 404, error: 'Prenda de destino no encontrada' };

  const [origen] = await db.select().from(productos).where(eq(productos.id, origenId)).limit(1);
  if (!origen) return { ok: false as const, estado: 404, error: 'Prenda de origen no encontrada' };

  if (productoId === origenId) {
    return { ok: false as const, estado: 400, error: 'La prenda de origen y la de destino son la misma' };
  }

  const resumen: any = {
    origen: { id: origen.id, itemNumero: origen.itemNumero, descripcion: origen.descripcion },
    destino: { id: destino.id, itemNumero: destino.itemNumero, descripcion: destino.descripcion },
    reemplazar,
    receta: null,
    pesos: null,
    manoObra: null,
    factor: null,
    tela: null,
    avisos: [] as string[],
  };

  // Las tallas visibles para el destino, para no crear filas de una talla que su colegio
  // no usa. Hoy las 16 son compartidas, pero el modelo admite tallas exclusivas.
  const listaTallas = await db.select().from(tallas);
  const tallasValidas = new Set(
    listaTallas
      .filter((t: any) => t.colegioId == null || t.colegioId === destino.colegioId)
      .map((t: any) => t.id)
  );

  // ------------------------------------------------------------------ tela
  if (que.tela) {
    if (!origen.telaId) {
      resumen.tela = { copiado: false, motivo: 'La prenda de origen no tiene tela asignada.' };
    } else if (destino.telaId && !reemplazar) {
      resumen.tela = {
        copiado: false,
        motivo: 'La prenda de destino ya tiene tela. Con "reemplazar" se sobreescribe.',
      };
    } else {
      await db.update(productos).set({ telaId: origen.telaId }).where(eq(productos.id, productoId));
      resumen.tela = { copiado: true, telaId: origen.telaId };
    }
  }

  // ---------------------------------------------------------------- factor
  if (que.factor) {
    const factorOrigen = Number(origen.factorComplejidad) || 1;
    const factorDestino = Number(destino.factorComplejidad) || 1;
    // Sin reemplazar solo se toca si el destino tiene el DEFAULT. Un factor distinto de 1
    // es una decision que alguien tomo, y copiar no debe deshacerla.
    if (!reemplazar && factorDestino !== 1) {
      resumen.factor = {
        copiado: false,
        motivo: `El destino ya tiene factor ${factorDestino}, distinto del default. Con "reemplazar" se sobreescribe.`,
      };
    } else {
      await db.update(productos).set({ factorComplejidad: factorOrigen }).where(eq(productos.id, productoId));
      resumen.factor = { copiado: true, de: factorDestino, a: factorOrigen };
    }
  }

  // ----------------------------------------------------------------- pesos
  if (que.pesos) {
    const pesosOrigen = await db.select().from(pesoMateriaPrima).where(eq(pesoMateriaPrima.productoId, origenId));
    const pesosDestino = await db.select().from(pesoMateriaPrima).where(eq(pesoMateriaPrima.productoId, productoId));
    const destinoPorTalla = new Map<string, any>();
    for (const p of pesosDestino) destinoPorTalla.set(p.tallaId, p);

    let actualizados = 0;
    let insertados = 0;
    let saltados = 0;
    const detalle: any[] = [];

    for (const po of pesosOrigen) {
      if (!tallasValidas.has(po.tallaId)) { saltados++; continue; }

      const valores = {
        pesoExactoGramos: Number(po.pesoExactoGramos) || 0,
        pesoGramos: Number(po.pesoGramos) || 0,
        mermaPorcentaje: Number(po.mermaPorcentaje) || 0,
        pesoConMerma: Number(po.pesoConMerma) || 0,
      };

      const existente = destinoPorTalla.get(po.tallaId);
      if (existente) {
        // Un peso ya cargado es trabajo humano. Sin reemplazar, solo se llena el vacio.
        const yaTieneDato = (Number(existente.pesoConMerma) || 0) > 0 || (Number(existente.pesoExactoGramos) || 0) > 0;
        if (yaTieneDato && !reemplazar) { saltados++; continue; }
        await db.update(pesoMateriaPrima).set(valores).where(eq(pesoMateriaPrima.id, existente.id));
        actualizados++;
      } else {
        await db.insert(pesoMateriaPrima).values({
          id: nuevoIdHex(),
          productoId,
          tallaId: po.tallaId,
          ...valores,
        });
        insertados++;
      }
      detalle.push({ tallaId: po.tallaId, pesoConMerma: valores.pesoConMerma });
    }

    resumen.pesos = { actualizados, insertados, saltados, detalle };

    // Sin tela, el peso no produce costo: costoTela es peso x precio por gramo.
    const telaFinal = que.tela && resumen.tela?.copiado ? origen.telaId : destino.telaId;
    if (!telaFinal && (actualizados + insertados) > 0) {
      resumen.avisos.push(
        'Se copiaron los pesos pero la prenda NO tiene tela asignada, asi que el costo de ' +
        'tela va a seguir siendo cero: se calcula como peso por precio del gramo, y sin tela ' +
        'no hay precio. Asignale una tela, o volve a copiar marcando tambien "tela".'
      );
    }
  }

  // ------------------------------------------------------------- mano obra
  // Fase 6: "copiar mano de obra" ya no copia filas de mano_obra por talla.
  // La MO vive en el tipo de prenda genérico (tipo_prenda + mano_obra_tipo). Copiar
  // consiste en asignar el mismo tipoPrendaId al destino. Es una sola fila en `producto`.
  if (que.manoObra) {
    const tipoOrigenId = origen.tipoPrendaId;
    const tipoDestinoId = destino.tipoPrendaId;

    if (!tipoOrigenId) {
      resumen.manoObra = { actualizados: 0, insertados: 0, saltados: 0 };
      resumen.avisos.push('La prenda de origen no tiene tipo de prenda asignado; no hay mano de obra que copiar.');
    } else if (tipoDestinoId && tipoDestinoId === tipoOrigenId) {
      resumen.manoObra = { actualizados: 0, insertados: 0, saltados: 1 };
      resumen.avisos.push('El destino ya tiene el mismo tipo de prenda asignado. Sin cambios.');
    } else if (tipoDestinoId && tipoDestinoId !== tipoOrigenId && !reemplazar) {
      resumen.manoObra = { actualizados: 0, insertados: 0, saltados: 1 };
      resumen.avisos.push(
        'El destino ya tiene un tipo de prenda asignado y "reemplazar" no está activo. ' +
        'Para sobreescribir, copiar con reemplazar=true.'
      );
    } else {
      await db.update(productos).set({ tipoPrendaId: tipoOrigenId }).where(eq(productos.id, productoId));
      resumen.manoObra = { actualizados: 1, insertados: 0, saltados: 0 };
    }
  }

  // ---------------------------------------------------------------- receta
  if (que.receta) {
    const receta = await db
      .select({
        accesorioId: detalleAccesorio.accesorioId,
        cantidadUso: detalleAccesorio.cantidadUso,
        descripcion: accesorios.descripcion,
        colegioId: accesorios.colegioId,
        costoUnitario: accesorios.costoUnitario,
      })
      .from(detalleAccesorio)
      .innerJoin(accesorios, eq(detalleAccesorio.accesorioId, accesorios.id))
      .where(eq(detalleAccesorio.productoId, origenId));

    if (reemplazar) {
      await db.delete(detalleAccesorio).where(eq(detalleAccesorio.productoId, productoId));
    }

    const yaHay = await db
      .select({ accesorioId: detalleAccesorio.accesorioId })
      .from(detalleAccesorio)
      .where(eq(detalleAccesorio.productoId, productoId));
    const yaAsignados = new Set(yaHay.map((r: any) => r.accesorioId));

    const copiados: any[] = [];
    const omitidosPorColegio: any[] = [];
    const omitidosYaExistian: any[] = [];
    const aInsertar: any[] = [];

    for (const linea of receta) {
      if (yaAsignados.has(linea.accesorioId)) {
        omitidosYaExistian.push({ descripcion: linea.descripcion });
        continue;
      }
      // Los insumos exclusivos del colegio de origen no pueden viajar. NO se aborta por
      // eso: se copia lo que corresponde y se dice que quedo afuera, porque abortar
      // obligaria a capturar todo a mano otra vez.
      if (!accesorioUsable(linea.colegioId, destino.colegioId)) {
        omitidosPorColegio.push({ descripcion: linea.descripcion, cantidadUso: linea.cantidadUso });
        continue;
      }
      aInsertar.push({
        id: nuevoIdHex(),
        productoId,
        accesorioId: linea.accesorioId,
        cantidadUso: linea.cantidadUso,
      });
      copiados.push({
        descripcion: linea.descripcion,
        cantidadUso: linea.cantidadUso,
        costoTotalBs: r2((Number(linea.cantidadUso) || 0) * (Number(linea.costoUnitario) || 0)),
      });
    }

    if (aInsertar.length > 0) await db.insert(detalleAccesorio).values(aInsertar);

    resumen.receta = {
      copiados,
      omitidosPorSerExclusivosDeOtroColegio: omitidosPorColegio,
      omitidosPorEstarYaAsignados: omitidosYaExistian,
      subtotalCopiadoBs: r2(copiados.reduce((t, l) => t + l.costoTotalBs, 0)),
    };

    if (omitidosPorColegio.length > 0) {
      resumen.avisos.push(
        `${omitidosPorColegio.length} insumo(s) no se copiaron por ser exclusivos de otro colegio: ` +
        omitidosPorColegio.map((o: any) => o.descripcion).join(', ') +
        '. Hay que crear el equivalente para este colegio y asignarlo a mano.'
      );
    }
  }

  return { ok: true as const, estado: 201, resumen };
}
