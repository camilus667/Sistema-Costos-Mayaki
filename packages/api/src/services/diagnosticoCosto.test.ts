import { describe, it, expect } from 'vitest';
import {
  diagnosticarPrenda,
  diagnosticarPorPrenda,
  resumirDiagnosticos,
  type MetaParaDiagnostico,
} from './diagnosticoCosto';

/**
 * TESTS DEL DIAGNOSTICO DE COSTO.
 *
 * Los casos salen de la base real, y DOS DE ELLOS son una correccion a mi propia medicion.
 *
 * Mi primera consulta fue `peso_gramos > 0` y `tela_id IS NOT NULL`, y dijo que habia dos
 * prendas sin costo: Chompa y Chaleco cuello en V. Era falso: las dos son
 * `modo_costeo = 'adquirido'` —el negocio las COMPRA, con 14 precios de adquisicion cada una—
 * asi que no llevan tela ni peso y no hay nada que marcar.
 *
 * Lo que el servicio encuentra corriendo contra la base:
 *
 *   Internacional SM  item 28  Camisa Formal   16 tallas ofrecidas, 14 con peso -> "sin pesos"
 *   Col. Cambridge    item 27  Saco            sin tela, pero 0 precios vigentes -> no se ofrece
 *   Col. Cambridge    items 19 y 20            adquiridas -> no se confeccionan
 *
 * Los tres casos que la consulta cruda confunde estan cubiertos por un test cada uno.
 */

const m = (o: Partial<MetaParaDiagnostico> = {}): MetaParaDiagnostico => ({
  origenPeso: 'pesoGramos',
  telaVinculada: true,
  tieneManoObra: true,
  seOfrece: true,
  modoCosteo: 'confeccion',
  ...o,
});

describe('una prenda completa no se marca', () => {
  it('con sus tres componentes, nada que reportar', () => {
    const d = diagnosticarPrenda([m(), m(), m()]);
    expect(d.completa).toBe(true);
    expect(d.faltan).toEqual([]);
    expect(d.etiqueta).toBe('');
    expect(d.motivo).toBe('');
  });

  it('y el detalle igual cuenta las tallas ofrecidas', () => {
    expect(diagnosticarPrenda([m(), m()]).detalle.tallasOfrecidas).toBe(2);
  });
});

describe('el caso real de la base: Camisa Formal, item 28 de Internacional SM', () => {
  it('con 2 de 16 tallas ofrecidas sin peso, se marca y dice el alcance', () => {
    // ES EL UNICO CASO MAL DE LA BASE HOY. Tiene tela y mano de obra, y 14 de sus 16 tallas
    // ofrecidas tienen peso: el costo de esas 2 esta subestimado y el de la prenda con el.
    const filas = [
      ...Array.from({ length: 14 }, () => m()),
      ...Array.from({ length: 2 }, () => m({ origenPeso: 'ninguno' })),
    ];
    const d = diagnosticarPrenda(filas);
    expect(d.completa).toBe(false);
    expect(d.faltan).toEqual(['pesos']);
    expect(d.etiqueta).toBe('sin pesos');
    expect(d.motivo).toContain('(2 de 16 tallas)');
    expect(d.detalle).toEqual({ tallasOfrecidas: 16, sinTela: 0, sinPesos: 2, sinManoObra: 0 });
  });

  it('y una prenda sin tela NI pesos dice LAS DOS cosas', () => {
    const filas = Array.from({ length: 16 }, () => m({ telaVinculada: false, origenPeso: 'ninguno' }));
    const d = diagnosticarPrenda(filas);
    expect(d.completa).toBe(false);
    expect(d.faltan).toEqual(['tela', 'pesos']);
    expect(d.etiqueta).toBe('sin tela · sin pesos');
    expect(d.motivo).toContain('SUBESTIMADO');
    expect(d.motivo).toContain('no tiene tela asignada');
    expect(d.motivo).toContain('no tiene el peso de tela cargado');
    expect(d.detalle).toEqual({ tallasOfrecidas: 16, sinTela: 16, sinPesos: 16, sinManoObra: 0 });
  });

  it('la TELA va primero, porque es la que hay que resolver antes', () => {
    // Sin tela, cargar los pesos no cambia el costo: el orden inverso mandaria a hacer un
    // trabajo que no sirve todavia.
    const d = diagnosticarPrenda([m({ telaVinculada: false, origenPeso: 'ninguno', tieneManoObra: false })]);
    expect(d.faltan).toEqual(['tela', 'pesos', 'mano-obra']);
    expect(d.etiqueta).toBe('sin tela · sin pesos · sin mano de obra');
  });
});

describe('cada falta por separado', () => {
  it('solo sin tela', () => {
    const d = diagnosticarPrenda([m({ telaVinculada: false })]);
    expect(d.faltan).toEqual(['tela']);
    expect(d.etiqueta).toBe('sin tela');
  });

  it('solo sin pesos', () => {
    const d = diagnosticarPrenda([m({ origenPeso: 'ninguno' })]);
    expect(d.faltan).toEqual(['pesos']);
  });

  it('solo sin mano de obra', () => {
    const d = diagnosticarPrenda([m({ tieneManoObra: false })]);
    expect(d.faltan).toEqual(['mano-obra']);
  });

  it('el peso exacto tambien cuenta como peso cargado', () => {
    // origenPeso tiene tres valores y solo 'ninguno' es una falta. Tratar
    // 'pesoExactoGramos' como faltante marcaria prendas que si tienen su peso.
    expect(diagnosticarPrenda([m({ origenPeso: 'pesoExactoGramos' })]).completa).toBe(true);
  });
});

describe('el alcance de la falta', () => {
  it('cuando falta en TODAS las tallas no repite el conteo', () => {
    const d = diagnosticarPrenda([m({ origenPeso: 'ninguno' }), m({ origenPeso: 'ninguno' })]);
    expect(d.motivo).not.toContain('de 2 tallas');
  });

  it('cuando falta en ALGUNAS lo dice, porque es otro tamaño de problema', () => {
    // "sin pesos" sobre una prenda entera y "sin pesos en 1 de 3 tallas" no son lo mismo.
    const d = diagnosticarPrenda([m(), m({ origenPeso: 'ninguno' }), m()]);
    expect(d.motivo).toContain('(1 de 3 tallas)');
    expect(d.detalle).toMatchObject({ tallasOfrecidas: 3, sinPesos: 1 });
  });
});

describe('lo que NO se marca, y por que', () => {
  it('una talla que no se ofrece no cuenta como falta', () => {
    // Que falte el peso de una talla que no se vende no es un problema accionable, y contarlo
    // llenaria la pantalla de avisos que nadie puede resolver.
    const d = diagnosticarPrenda([m(), m({ seOfrece: false, origenPeso: 'ninguno', telaVinculada: false })]);
    expect(d.completa).toBe(true);
    expect(d.detalle.tallasOfrecidas).toBe(1);
  });

  it('una prenda ADQUIRIDA no se marca: no se confecciona', () => {
    // No lleva peso de tela ni mano de obra por definicion. Marcarla seria reportar como
    // falta algo que su modo de costeo no usa.
    const d = diagnosticarPrenda([m({ modoCosteo: 'adquirido', origenPeso: 'ninguno', telaVinculada: false, tieneManoObra: false })]);
    expect(d.completa).toBe(true);
    expect(d.faltan).toEqual([]);
  });

  it('sin ninguna talla no inventa un faltante', () => {
    // Una prenda sin variantes es otro problema y no es este el lugar para reportarlo.
    // Inventar una marca pondria un cartel sobre algo que este diagnostico no midio.
    expect(diagnosticarPrenda([]).completa).toBe(true);
    expect(diagnosticarPrenda([m({ seOfrece: false })]).completa).toBe(true);
  });

  it('null o undefined no lo hacen explotar', () => {
    // Lo que de verdad protege la primera guarda. La lista VACIA ya la cubre el chequeo de
    // `ofrecidas.length === 0` que viene despues, asi que un test con `[]` no discrimina:
    // pasa igual sin la guarda. Con null, sin ella, `metas.some` tira.
    //
    // Y este caso llega solo: una prenda cuyo colegio no tiene tallas configuradas no produce
    // filas costeadas, y el que llame puede pasarle lo que devolvio un `Map.get`.
    expect(diagnosticarPrenda(null as any).completa).toBe(true);
    expect(diagnosticarPrenda(undefined as any).completa).toBe(true);
  });
});

describe('agrupado por prenda', () => {
  it('cada prenda recibe su propio diagnostico', () => {
    const filas = [
      { id: 'p1', meta: m() },
      { id: 'p1', meta: m() },
      { id: 'p2', meta: m({ telaVinculada: false }) },
      { id: 'p3', meta: m({ tieneManoObra: false }) },
    ];
    const r = diagnosticarPorPrenda(filas, (f) => f.id, (f) => f.meta);
    expect(r.get('p1')!.completa).toBe(true);
    expect(r.get('p2')!.faltan).toEqual(['tela']);
    expect(r.get('p3')!.faltan).toEqual(['mano-obra']);
  });

  it('una prenda con UNA talla mala queda marcada, no promediada', () => {
    // Es la decision importante del agrupado: si una talla ofrecida no costea, el costo de la
    // prenda esta subestimado. Pedir que fallen todas dejaria pasar el caso mas comun.
    const filas = [{ id: 'p1', meta: m() }, { id: 'p1', meta: m({ origenPeso: 'ninguno' }) }];
    const r = diagnosticarPorPrenda(filas, (f) => f.id, (f) => f.meta);
    expect(r.get('p1')!.completa).toBe(false);
  });
});

describe('resumen para el encabezado del reporte', () => {
  it('cuenta cuantas prendas tienen el costo subestimado', () => {
    // La base real tiene 28 prendas y UNA marcada: Camisa Formal, sin pesos en 2 de 16 tallas.
    // Este caso usa tres marcadas a proposito, para que los tres contadores tengan valor.
    const diags = [
      ...Array.from({ length: 25 }, () => diagnosticarPrenda([m()])),
      diagnosticarPrenda([m({ telaVinculada: false })]),
      diagnosticarPrenda([m({ telaVinculada: false, origenPeso: 'ninguno' })]),
      diagnosticarPrenda([m({ telaVinculada: false, origenPeso: 'ninguno' })]),
    ];
    expect(resumirDiagnosticos(diags)).toEqual({
      total: 28, incompletas: 3, sinTela: 3, sinPesos: 2, sinManoObra: 0,
    });
  });

  it('sin nada incompleto los conteos quedan en cero', () => {
    expect(resumirDiagnosticos([diagnosticarPrenda([m()])])).toEqual({
      total: 1, incompletas: 0, sinTela: 0, sinPesos: 0, sinManoObra: 0,
    });
  });
});
