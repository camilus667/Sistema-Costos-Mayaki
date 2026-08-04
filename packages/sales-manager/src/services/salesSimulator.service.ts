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

const CLIENTES_REALISTAS = [
  { cliente: 'Juan Carlos Perez', doc: '8472910', razon: 'Juan Carlos Perez' },
  { cliente: 'Maria Elena Quispe', doc: '4920183', razon: 'Maria Elena Quispe' },
  { cliente: 'Carlos Alberto Rodriguez', doc: '7392014', razon: 'Rodriguez S.R.L.' },
  { cliente: 'Ana Patricia Mamani', doc: '9281042', razon: 'Sin Nombre' },
  { cliente: 'Fernando Flores', doc: '5829104', razon: 'Flores' },
  { cliente: 'Patricia Gonzales', doc: '1029384', razon: 'Patricia Gonzales' },
  { cliente: 'Ramiro Mendoza', doc: '6849201', razon: 'Mendoza' },
  { cliente: 'Laura Gutierrez', doc: '3948102', razon: 'Laura Gutierrez' },
  { cliente: 'Jose Luis Fernandez', doc: '10293841019', razon: 'Fernandez Hermanos' },
  { cliente: 'Sofia Vargas', doc: '4820193', razon: 'Sofia Vargas' },
  { cliente: 'Diego Morales', doc: '7492018', razon: 'Sin Nombre' },
  { cliente: 'Claudia Camacho', doc: '2039481021', razon: 'Camacho' },
  { cliente: 'Gabriel Rojas', doc: '5920184', razon: 'Gabriel Rojas' },
  { cliente: 'Veronica Torrico', doc: '4928190018', razon: 'Veronica Torrico' },
  { cliente: 'Marcelo Chavez', doc: '8392014', razon: 'Chavez' },
  { cliente: 'Roxana Justiniano', doc: '9482019', razon: 'Justiniano' },
  { cliente: 'Gonzalo Aguilar', doc: '6392018', razon: 'Gonzalo Aguilar' },
  { cliente: 'Monica Saucedo', doc: '3829104', razon: 'Saucedo' },
  { cliente: 'Jorge Luis Baldivieso', doc: '7291048', razon: 'Baldivieso' },
  { cliente: 'Sonia Mercado', doc: '8492015', razon: 'Sonia Mercado' },
];

const PUNTOS_DE_VENTA = ['Caja 1', 'Caja 2', 'Caja Central'];

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
  const vendedor = opciones.vendedorNombre || 'Gardenia Limachi';
  const sucursal = opciones.sucursal || 'Central';
  let nPedidoActual = (opciones.nPedidoInicial && opciones.nPedidoInicial > 0) ? opciones.nPedidoInicial : 581;

  const fInicio = opciones.fechaInicioIso ? new Date(opciones.fechaInicioIso) : new Date(2026, 1, 15);
  const fFin = opciones.fechaFinIso ? new Date(opciones.fechaFinIso) : new Date(2026, 3, 30);
  const diffTime = Math.max(fFin.getTime() - fInicio.getTime(), 86400000);

  const colegioDestinoSufijo = proyeccion.colegioDestino;

  // 1. Crear Pool de ítems proyectados
  interface ItemSim {
    nombreProductoSim: string;
    cant: number;
    precioUnitario: number;
  }

  const itemPool: ItemSim[] = [];

  proyeccion.mapeos.forEach((mapeo) => {
    Object.keys(mapeo.tallasDesglose).forEach((talla) => {
      const cantidadTotal = Math.round(mapeo.tallasDesglose[talla]);
      if (cantidadTotal <= 0) return;

      let cantidadRestante = cantidadTotal;

      while (cantidadRestante > 0) {
        const cantSub = Math.min(cantidadRestante, Math.floor(Math.random() * 2) + 1);
        cantidadRestante -= cantSub;

        itemPool.push({
          nombreProductoSim: `${mapeo.prendaDestino}, ${colegioDestinoSufijo} (Talla ${talla})`,
          cant: cantSub,
          precioUnitario: mapeo.precioEstDestino || 100,
        });
      }
    });
  });

  // 2. Mezclar aleatoriamente el Pool de productos (Fisher-Yates Shuffle)
  for (let i = itemPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [itemPool[i], itemPool[j]] = [itemPool[j], itemPool[i]];
  }

  // 3. Agrupar ítems mezclados en pedidos (1 a 3 ítems por n_pedido)
  interface PedidoGrupo {
    items: ItemSim[];
  }
  const pedidosGrupos: PedidoGrupo[] = [];
  let tempIdx = 0;
  while (tempIdx < itemPool.length) {
    const count = Math.min(itemPool.length - tempIdx, Math.floor(Math.random() * 3) + 1);
    pedidosGrupos.push({
      items: itemPool.slice(tempIdx, tempIdx + count),
    });
    tempIdx += count;
  }

  const totalPedidos = pedidosGrupos.length;

  // 4. Generar filas simulando pedidos distribuídos en el 100% del rango de fechas (con decaimiento estacional)
  const filas: any[][] = [];

  // Fila 0: Título del reporte
  filas.push([`Reporte de Ventas  del ${fInicio.toISOString().slice(0, 10)} al ${fFin.toISOString().slice(0, 10)}`]);

  // Fila 1: Cabeceras oficiales
  filas.push(CABECERAS_OFICIALES);

  pedidosGrupos.forEach((pedido, pIdx) => {
    // u varía de 0.0 (inicio) a 1.0 (final)
    const u = totalPedidos > 1 ? pIdx / (totalPedidos - 1) : 0;

    // Curva de decaimiento estacional (u^1.8):
    // Concentra el 50% de las ventas en el primer 25% del tiempo (Alta demanda en febrero/marzo)
    // y extiende el resto suavemente hasta cubrir el 100% del rango (ej. 03/08/2026)
    const uTime = Math.pow(u, 1.8);

    const timeMs = fInicio.getTime() + uTime * diffTime;
    const orderDate = new Date(timeMs);

    // Formatear hora entre 09:00 AM y 19:00 PM (horario comercial de tienda)
    const hourMod = 9 + Math.floor(((pIdx * 7) % 10));
    const minMod = Math.floor(((pIdx * 13) % 60));
    orderDate.setHours(hourMod, minMod);

    // Ajustar si cae en fin de semana (Sábado = 6, Domingo = 0) para trasladar al Lunes siguiente
    if (orderDate.getDay() === 6) {
      orderDate.setDate(orderDate.getDate() + 2);
    } else if (orderDate.getDay() === 0) {
      orderDate.setDate(orderDate.getDate() + 1);
    }

    const fechaFormatted = formatearFechaReporte(orderDate);

    // Datos del pedido
    const clienteObj = CLIENTES_REALISTAS[nPedidoActual % CLIENTES_REALISTAS.length];
    const estadoVal = Math.random() < 0.97 ? 'Completado' : 'Pendiente';
    const tipoVal = Math.random() < 0.05 ? 'Factura' : 'Pedido';

    // 30% registran cliente (o 100% si es Factura); 70% son ventas mostrador anónimas
    const registraCliente = (tipoVal === 'Factura') || (Math.random() < 0.30);
    const clienteNombre = registraCliente ? clienteObj.cliente : ' ';
    const clienteDoc = (tipoVal === 'Factura' || (registraCliente && Math.random() < 0.5)) ? clienteObj.doc : '';
    const clienteRazon = (tipoVal === 'Factura' || (registraCliente && Math.random() < 0.5)) ? clienteObj.razon : '';

    pedido.items.forEach((item) => {
      const subtotal = Math.round(item.cant * item.precioUnitario * 100) / 100;
      const totalCobrado = subtotal;

      const randPago = Math.random();
      let qr = 0;
      let efectivo = 0;
      let tarjeta = 0;
      let transferencia = 0;

      if (randPago < 0.55) qr = totalCobrado;
      else if (randPago < 0.85) efectivo = totalCobrado;
      else if (randPago < 0.95) tarjeta = totalCobrado;
      else transferencia = totalCobrado;

      const fila: any[] = [
        String(nPedidoActual),
        tipoVal,
        estadoVal,
        fechaFormatted,
        sucursal,
        '', // punto_de_venta (vacío en la mayoría de reportes POS)
        vendedor,
        clienteNombre,
        clienteDoc,
        clienteRazon,
        '', // id_cliente
        '', // cpf_cliente
        item.nombreProductoSim,
        item.cant,
        item.precioUnitario,
        subtotal,
        0, // descuento_por_producto
        0, // descuento_general
        0, // descuento_general_aplicado_a_producto
        0, // total_descuento
        totalCobrado,
        0, // $imple
        0, // a_credito
        0, // cheque
        0, // deposito_bancario
        efectivo,
        0, // otros
        qr,
        0, // tarjeta
        tarjeta,
        0, // tigo_money
        transferencia,
        0, // vales
        '', // costo_unit (habitualmente vacío en POS)
        '', // costo_total (habitualmente vacío en POS)
        '', // margen_de_ganancia_estimado (habitualmente vacío en POS)
        '', // glosa
        '', // nota_de_pedido
      ];

      filas.push(fila);
    });

    nPedidoActual++;
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(filas);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet0');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return buffer as Buffer;
}
