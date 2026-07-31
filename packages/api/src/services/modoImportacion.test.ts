/**
 * Lo que se fija aca es QUE TOCA CADA MODO, que es la unica pregunta que importa antes de
 * sobrescribir precios o cantidades de un colegio entero.
 *
 * Y se fija la COMPATIBILIDAD: una peticion sin `modo` tiene que seguir haciendo exactamente lo que
 * hacia antes, porque el precio se escribia siempre. Si esa deduccion cambiara, un cliente ya
 * escrito empezaria a importar otra cosa sin que nadie lo pida.
 */

import { describe, it, expect } from 'vitest';
import {
  MODOS,
  efectosDelModo,
  resolverModo,
  etiquetaModo,
  descripcionModo,
  advertenciaModo,
  type ModoImportacion,
} from './modoImportacion';

describe('efectosDelModo', () => {
  it('solo precios NO toca el inventario', () => {
    expect(efectosDelModo('precios')).toEqual({
      escribePrecios: true, escribeInventario: false, creaPrendasSiempre: false,
    });
  });

  it('solo inventario NO toca los precios', () => {
    // Es el modo que no existia. Antes el precio se escribia siempre, asi que pedir "solo
    // inventario" reescribia igual los 429 precios del colegio.
    expect(efectosDelModo('inventario')).toEqual({
      escribePrecios: false, escribeInventario: true, creaPrendasSiempre: false,
    });
  });

  it('precios e inventario escribe las dos cosas', () => {
    const e = efectosDelModo('precios-inventario');
    expect(e.escribePrecios).toBe(true);
    expect(e.escribeInventario).toBe(true);
  });

  it('solo prendas NO escribe ni precios ni cantidades', () => {
    expect(efectosDelModo('prendas')).toEqual({
      escribePrecios: false, escribeInventario: false, creaPrendasSiempre: true,
    });
  });

  it('solo el modo prendas implica el alta', () => {
    // En los otros tres el alta es una decision aparte: importar precios sobre las prendas que ya
    // existen es un caso legitimo y frecuente.
    const implican = MODOS.filter((m) => efectosDelModo(m).creaPrendasSiempre);
    expect(implican).toEqual(['prendas']);
  });

  it('ningun modo deja las tres cosas apagadas', () => {
    // Un modo que no escribe nada seria un boton "Importar" que no importa. Si algun dia se agrega
    // un modo nuevo y se olvida cablearlo, esto lo detecta.
    for (const m of MODOS) {
      const e = efectosDelModo(m);
      expect(e.escribePrecios || e.escribeInventario || e.creaPrendasSiempre).toBe(true);
    }
  });
});

describe('resolverModo', () => {
  it('respeta el modo pedido', () => {
    for (const m of MODOS) {
      const r = resolverModo({ modo: m });
      expect(r.ok && r.modo).toBe(m);
    }
  });

  it('recorta los espacios del modo', () => {
    const r = resolverModo({ modo: '  inventario ' });
    expect(r.ok && r.modo).toBe('inventario');
  });

  it('sin modo conserva el comportamiento historico: el precio se escribia siempre', () => {
    expect((resolverModo({}) as any).modo).toBe('precios');
    expect((resolverModo({ crearPrendas: true }) as any).modo).toBe('precios');
    expect((resolverModo({ inventario: false }) as any).modo).toBe('precios');
  });

  it('sin modo y con la bandera vieja de inventario da los dos', () => {
    expect((resolverModo({ inventario: true }) as any).modo).toBe('precios-inventario');
  });

  it('la bandera vieja SOLA nunca deduce solo-inventario', () => {
    // Seria un cambio de comportamiento silencioso: un cliente ya escrito que manda
    // `inventario: true` esperando precios TAMBIEN dejaria de importar los precios.
    expect((resolverModo({ inventario: true }) as any).modo).not.toBe('inventario');
  });

  it('un modo vacio se trata como ausente, no como error', () => {
    // Un `<select>` sin elegir manda la cadena vacia. Eso no es un modo invalido: es no haber
    // elegido, y ahi corresponde el comportamiento por defecto.
    expect((resolverModo({ modo: '' }) as any).modo).toBe('precios');
    expect((resolverModo({ modo: '   ' }) as any).modo).toBe('precios');
    expect((resolverModo({ modo: null }) as any).modo).toBe('precios');
  });

  it('un modo desconocido FALLA, no cae al de por defecto', () => {
    // Importar con el modo por defecto ante un modo que no se entiende es la peor respuesta
    // posible cuando lo que esta en juego es que filas se sobrescriben.
    const r = resolverModo({ modo: 'todo' });
    expect(r.ok).toBe(false);
    expect((r as any).error).toContain('todo');
    expect((r as any).error).toContain('precios-inventario');
  });

  it('un modo con otra caja NO se acepta', () => {
    // La tolerancia de caja invita a dos escrituras distintas del mismo modo, y despues a un
    // `toLowerCase` puesto en un solo lado. El valor sale de un `<select>` del propio sistema.
    expect(resolverModo({ modo: 'PRECIOS' }).ok).toBe(false);
  });

  it('opciones nulas no revientan', () => {
    expect((resolverModo(null) as any).modo).toBe('precios');
    expect((resolverModo(undefined) as any).modo).toBe('precios');
  });
});

describe('los textos de cada modo', () => {
  it('los cuatro modos tienen etiqueta, descripcion y advertencia', () => {
    // Un modo sin texto llega a la pantalla como un hueco. Esto obliga a escribirlos al agregar uno.
    for (const m of MODOS) {
      expect(etiquetaModo(m).length).toBeGreaterThan(3);
      expect(descripcionModo(m).length).toBeGreaterThan(20);
      expect(advertenciaModo(m)).not.toBeNull();
    }
  });

  it('cada modo dice explicitamente que NO toca', () => {
    // Es la mitad que faltaba: la pantalla anunciaba "trae precios y codigos" y nunca decia que el
    // inventario quedaba intacto, asi que no se sabia si importar pisaba el conteo.
    expect(descripcionModo('precios')).toMatch(/inventario no se toca/i);
    expect(descripcionModo('inventario')).toMatch(/precios y los codigos no se tocan/i);
    expect(descripcionModo('prendas')).toMatch(/no escribe ningun precio/i);
  });

  it('las etiquetas son distintas entre si', () => {
    const vistas = new Set(MODOS.map(etiquetaModo));
    expect(vistas.size).toBe(MODOS.length);
  });

  it('la advertencia de inventario avisa que pisa el conteo', () => {
    expect(advertenciaModo('inventario')).toMatch(/REEMPLAZAN/);
  });

  it('la advertencia de precios avisa que el anterior no queda', () => {
    expect(advertenciaModo('precios')).toMatch(/no queda guardado/i);
  });

  it('no hay modo sin cablear en el switch', () => {
    // Si se agrega un modo al tipo y se olvida un `case`, la funcion devuelve undefined y la
    // pantalla muestra "undefined". Esto lo agarra sin depender del typecheck.
    for (const m of MODOS) {
      expect(typeof efectosDelModo(m as ModoImportacion)).toBe('object');
      expect(typeof etiquetaModo(m as ModoImportacion)).toBe('string');
    }
  });
});
