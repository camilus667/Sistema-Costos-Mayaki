import { describe, it, expect } from 'vitest';
import {
  leerModalidadFiscal,
  descuentoSinFacturaComoFraccion,
  construirContextoFiscal,
  precioVentaEfectivo,
  ingresoNetoEfectivo,
  resolverPrecios,
  etiquetaModalidad,
  type ContextoFiscal,
} from './modalidadFiscal';

/**
 * TESTS DEL MODO FISCAL.
 *
 * Fijan la regla que se acordo con el usuario el 30-jul-2026 y, sobre todo, fijan
 * el DEFECTO que motivo el modulo, para que no vuelva: el precio con factura tiene
 * que ser el de lista y el precio sin factura el de lista menos el descuento. Antes
 * el sistema mostraba 87 con factura contra 90 sin factura —o sea el canal oficial
 * mas BARATO que el informal, y una diferencia de 3,3% entre modos que el usuario
 * leyo, con razon, como "no pasa nada al tocar el interruptor".
 *
 * Los numeros de aca salen de la base real de Cambridge: IVA 13% (`tasa_iva` = 13),
 * descuento por defecto 10%, `impuestos_activos` ausente y por lo tanto false, y un
 * Pantalon de vestir cuyo precio de lista en la talla 16/34 es 180,00 Bs.
 */

const req = (qs: Record<string, string>) => ({ req: { query: (k: string) => qs[k] } });

const fiscal = (over: Partial<ContextoFiscal> = {}): ContextoFiscal => ({
  modalidad: 'sinFactura',
  descuentoFraccion: 0.1,
  tasaIvaFraccion: 0.13,
  impuestosActivos: false,
  ...over,
});

describe('lectura del modo desde el request', () => {
  it("solo la cadena 'true' exacta activa el modo con factura", () => {
    expect(leerModalidadFiscal(req({ modalidadF: 'true' }))).toBe('conFactura');
  });

  it('sin parametro cae en sin factura, que es el lado conservador', () => {
    // Coincide con el default `modalidadFActual = false` del dashboard.
    expect(leerModalidadFiscal(req({}))).toBe('sinFactura');
  });

  it('un valor raro no adivina: cae en sin factura', () => {
    for (const v of ['1', 'TRUE', 'si', 'yes', '']) {
      expect(leerModalidadFiscal(req({ modalidadF: v }))).toBe('sinFactura');
    }
  });
});

describe('el descuento sin factura como fraccion', () => {
  it('una fraccion pasa tal cual', () => {
    expect(descuentoSinFacturaComoFraccion({ descuentoSinFactura: 0.1 })).toBe(0.1);
  });

  it('un PORCENTAJE se convierte, que es la trampa de unidades del proyecto', () => {
    // Sin esta guarda, `1 - 10` da -9: un precio de venta negativo nueve veces el
    // original. Y estaba a un solo tecleo, porque la pantalla de configuracion
    // guardaba el numero crudo.
    expect(descuentoSinFacturaComoFraccion({ descuentoSinFactura: 10 })).toBe(0.1);
    expect(descuentoSinFacturaComoFraccion({ descuentoSinFactura: 15 })).toBe(0.15);
  });

  it('un valor absurdo avisa y usa el default en vez de valorizar el stock en monedas', () => {
    const avisos: string[] = [];
    expect(descuentoSinFacturaComoFraccion({ descuentoSinFactura: 99 }, avisos)).toBe(0.1);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatch(/descuento sin factura/i);
  });

  it('cero, negativo o basura caen en el default de 10%', () => {
    expect(descuentoSinFacturaComoFraccion({ descuentoSinFactura: 0 })).toBe(0.1);
    expect(descuentoSinFacturaComoFraccion({ descuentoSinFactura: -3 })).toBe(0.1);
    expect(descuentoSinFacturaComoFraccion({ descuentoSinFactura: NaN })).toBe(0.1);
  });
});

describe('precio de venta efectivo — la regla acordada', () => {
  it('CON FACTURA el precio mostrado es el de lista', () => {
    expect(precioVentaEfectivo(180, fiscal({ modalidad: 'conFactura' }))).toBe(180);
  });

  it('SIN FACTURA el precio mostrado es el de lista menos 10%', () => {
    expect(precioVentaEfectivo(180, fiscal())).toBeCloseTo(162, 10);
  });

  it('la diferencia entre modos es exactamente el descuento, no el 3,3% de antes', () => {
    const con = precioVentaEfectivo(180, fiscal({ modalidad: 'conFactura' }));
    const sin = precioVentaEfectivo(180, fiscal());
    expect(sin / con).toBeCloseTo(0.9, 10);
  });

  it('el precio con factura NUNCA es menor que el sin factura', () => {
    // Es el error de signo que producia el sintoma: el canal oficial salia mas
    // barato que el informal.
    for (const lista of [1, 45.5, 100, 180, 250, 1234.56]) {
      const con = precioVentaEfectivo(lista, fiscal({ modalidad: 'conFactura' }));
      const sin = precioVentaEfectivo(lista, fiscal());
      expect(con).toBeGreaterThan(sin);
    }
  });

  it('sin precio de lista devuelve 0 y no inventa nada', () => {
    for (const v of [0, null, undefined, -5, NaN]) {
      expect(precioVentaEfectivo(v as any, fiscal())).toBe(0);
    }
  });
});

describe('ingreso neto — respeta impuestosActivos, igual que el motor', () => {
  it('con factura y el check APAGADO, el ingreso es el precio de lista', () => {
    // Es el estado real de la base: `impuestos_activos` no existe como fila.
    expect(ingresoNetoEfectivo(100, fiscal({ modalidad: 'conFactura' }))).toBe(100);
  });

  it('con factura y el check PRENDIDO, el IVA va por dentro: de 100 quedan 87', () => {
    expect(
      ingresoNetoEfectivo(100, fiscal({ modalidad: 'conFactura', impuestosActivos: true }))
    ).toBeCloseTo(87, 10);
  });

  it('sin factura el descuento se aplica aunque el check este apagado', () => {
    // Es un descuento de precio, no un impuesto: si no facturas lo resignas igual.
    expect(ingresoNetoEfectivo(100, fiscal())).toBeCloseTo(90, 10);
    expect(ingresoNetoEfectivo(100, fiscal({ impuestosActivos: true }))).toBeCloseTo(90, 10);
  });
});

describe('resolverPrecios — las tres cantidades salen del mismo modo', () => {
  it('sin factura: precio cobrado e ingreso neto coinciden, no hay debito fiscal', () => {
    const r = resolverPrecios(180, fiscal());
    expect(r.precioLista).toBe(180);
    expect(r.precioVenta).toBeCloseTo(162, 10);
    expect(r.ingresoNeto).toBeCloseTo(162, 10);
    expect(r.ivaDebito).toBeCloseTo(0, 10);
  });

  it('con factura y el check prendido, el debito fiscal es la diferencia', () => {
    const r = resolverPrecios(180, fiscal({ modalidad: 'conFactura', impuestosActivos: true }));
    expect(r.precioVenta).toBe(180);
    expect(r.ingresoNeto).toBeCloseTo(156.6, 10);
    expect(r.ivaDebito).toBeCloseTo(23.4, 10);
    // Y cierra: lo facturado menos el debito es lo que queda.
    expect(r.precioVenta - r.ivaDebito).toBeCloseTo(r.ingresoNeto, 10);
  });

  it('con factura y el check apagado no hay debito, asi que venta = ingreso', () => {
    const r = resolverPrecios(180, fiscal({ modalidad: 'conFactura' }));
    expect(r.precioVenta).toBe(180);
    expect(r.ingresoNeto).toBe(180);
    expect(r.ivaDebito).toBe(0);
  });
});

describe('construirContextoFiscal — una sola lectura por respuesta', () => {
  const ctx = (over: any = {}) => ({
    tasaIvaFraccion: 0.13,
    sysConfig: { descuentoSinFactura: 0.1, impuestosActivos: false, ...over },
  });

  it('arma el contexto desde el request y el contexto de costeo', () => {
    const f = construirContextoFiscal(req({ modalidadF: 'true' }), ctx());
    expect(f).toEqual({
      modalidad: 'conFactura',
      descuentoFraccion: 0.1,
      tasaIvaFraccion: 0.13,
      impuestosActivos: false,
    });
  });

  it('normaliza un descuento cargado como porcentaje en la base', () => {
    const f = construirContextoFiscal(req({}), ctx({ descuentoSinFactura: 10 }));
    expect(f.descuentoFraccion).toBe(0.1);
  });

  it('una tasa de IVA en cero cae al 13% en vez de dejar el ingreso sin ajustar', () => {
    const f = construirContextoFiscal(req({}), { ...ctx(), tasaIvaFraccion: 0 });
    expect(f.tasaIvaFraccion).toBe(0.13);
  });
});

describe('etiqueta para la pantalla', () => {
  it('nombra el modo en los terminos del usuario', () => {
    expect(etiquetaModalidad('conFactura')).toMatch(/Con Factura/);
    expect(etiquetaModalidad('sinFactura')).toMatch(/Sin Factura/);
  });
});
