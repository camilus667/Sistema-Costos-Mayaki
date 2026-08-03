import * as XLSX from 'xlsx';
import { ResultadoProyeccion } from './salesProjection.service';

export interface SimualicionOpciones {
  vendedorNombre?: string;
  nPedidoInicial?: number;
  sucursal?: string;
  fechaInicioIso?: string;
  fechaFinIso?: string;
}

const CABECERAS_OFICIALES = [
  'n_pedido',
  'tipo',
  'estado',
  'fecha',
  'sucursal',
  'punto_de_venta',
  'usuario',
  'cliente',
  'numero_documento',
  'razon_social',
  'id_cliente',
  'cpf_cliente',
  'nombre_del_producto',
  'cantidad',
  'precio_unit',
  'subtotal',
  'descuento_por_producto',
  'descuento_general',
  'descuento_general_aplicado_a_producto',
  'total_descuento',
  'total_cobrado',
  '$imple',
  'a_credito',
  'cheque',
  'deposito_bancario',
  'efectivo',
  'otros',
  'qr_-_simple',
  'tarjeta',
  'tarjeta_de_credito/debito',
  'tigo_money',
  'transferencia_bancaria',
  'vales',
  'costo_unit',
  'costo_total',
  'margen_de_ganancia_estimado',
  'glosa',
  'nota_de_pedido',
];

const MESES_ABREV = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatearFechaReporte(d: Date): string {
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = MESES_ABREV[d.getMonth()];
  const anio = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dia}/${mes}/${anio} - ${hh}:${mm}`;
}

export function generarVentasSimuladasExcelBuffer(
  proyeccion: ResultadoProyeccion,
  opciones: SimualicionOpciones = {}
): Buffer {
  const vendedor = opciones.vendedorNombre || 'Sara Limachi SM';
  const sucursal = opciones.sucursal || 'Central';
  let nPedidoActual = opciones.nPedidoInicial || 3000;

  const fInicio = opciones.fechaInicioIso ? new Date(opciones.fechaInicioIso) : new Date(2026, 0, 15);
  const fFin = opciones.fechaFinIso ? new Date(opciones.fechaFinIso) : new Date(2026, 2, 31);
  const diffTime = Math.max(fFin.getTime() - fInicio.getTime(), 86400000);

  const colegioDestinoSufijo = proyeccion.colegioDestino;

  const filas: any[][] = [];

  // Fila 0: Titulo del reporte
  filas.push([`Reporte de Ventas  del ${fInicio.toISOString().slice(0, 10)} al ${fFin.toISOString().slice(0, 10)}`]);

  // Fila 1: Cabeceras oficiales
  filas.push(CABECERAS_OFICIALES);

  let itemCounter = 0;

  proyeccion.mapeos.forEach((mapeo) => {
    Object.keys(mapeo.tallasDesglose).forEach((talla) => {
      const cantidadTotal = Math.round(mapeo.tallasDesglose[talla]);
      if (cantidadTotal <= 0) return;

      let cantidadRestante = cantidadTotal;

      while (cantidadRestante > 0) {
        const cantEnPedido = Math.min(cantidadRestante, Math.floor(Math.random() * 3) + 1);
        cantidadRestante -= cantEnPedido;
        itemCounter++;

        if (itemCounter % 2 === 0) nPedidoActual++;

        const randomTime = fInicio.getTime() + Math.random() * diffTime;
        const fechaSim = new Date(randomTime);
        fechaSim.setHours(9 + Math.floor(Math.random() * 9), Math.floor(Math.random() * 60));

        const fechaFormatted = formatearFechaReporte(fechaSim);

        const nombreProductoSim = `${mapeo.prendaDestino}, ${colegioDestinoSufijo} (Talla ${talla})`;
        const precioUnitario = mapeo.precioEstDestino || 100;
        const subtotal = Math.round(cantEnPedido * precioUnitario * 100) / 100;
        const totalCobrado = subtotal;

        const randPago = Math.random();
        let qr = 0;
        let efectivo = 0;
        let otros = 0;

        if (randPago < 0.5) qr = totalCobrado;
        else if (randPago < 0.8) efectivo = totalCobrado;
        else otros = totalCobrado;

        const costoUnit = Math.round(precioUnitario * 0.45 * 100) / 100;
        const costoTotal = Math.round(costoUnit * cantEnPedido * 100) / 100;
        const margenEstimado = Math.round((totalCobrado - costoTotal) * 100) / 100;

        const fila: any[] = [
          String(nPedidoActual),
          'Pedido',
          'Completado',
          fechaFormatted,
          sucursal,
          '',
          vendedor,
          ' ',
          '',
          '',
          '',
          '',
          nombreProductoSim,
          cantEnPedido,
          precioUnitario,
          subtotal,
          0,
          0,
          0,
          0,
          totalCobrado,
          0,
          0,
          0,
          0,
          efectivo,
          otros,
          qr,
          0,
          0,
          0,
          0,
          0,
          costoUnit,
          costoTotal,
          margenEstimado,
          '',
          '',
        ];

        filas.push(fila);
      }
    });
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(filas);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet0');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return buffer as Buffer;
}
