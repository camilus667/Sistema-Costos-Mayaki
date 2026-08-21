import fs from 'fs';
import path from 'path';
import {
  MovimientoBancario,
  CategoriaTransaccion,
  ResumenMensualClasificado,
  ContraparteRecurrenteItem,
  AnomaliaDetectadaItem,
  CategoriaResumenItem,
  ReglaPersonaConocida,
  CategoriaCustomMeta,
} from '../types';
import { clasificarTransaccion } from './bankParser.service';

const NOMBRE_MESES: Record<number, string> = {
  1: 'Enero',
  2: 'Febrero',
  3: 'Marzo',
  4: 'Abril',
  5: 'Mayo',
  6: 'Junio',
  7: 'Julio',
  8: 'Agosto',
  9: 'Septiembre',
  10: 'Octubre',
  11: 'Noviembre',
  12: 'Diciembre',
};

export function obtenerNombreTitularNormalizado(banco: string, rawNombre?: string): string {
  const bUpper = (banco || '').toUpperCase();
  if (bUpper.includes('BISA')) return 'MODA MAYAKI';
  if (bUpper.includes('BNB') || bUpper.includes('NACIONAL')) return 'Angel Limachi';
  if (bUpper.includes('UNIÓN') || bUpper.includes('UNION')) return 'VEIMAR LIMACHI MORON';
  return rawNombre || 'MODA MAYAKI';
}

const CATEGORIA_META: Record<string, { nombre: string; icono: string }> = {
  COMPRA_TELAS_INSUMOS: { nombre: 'Compra de Telas e Insumos / Mercería', icono: '' },
  VENTA_UNIFORMES_CLIENTE: { nombre: 'Venta de Uniformes (Colegios / Empresas)', icono: '' },
  ROPA_A_MEDIDA: { nombre: 'Ropa a Medida / Trajes Personalizados', icono: '' },
  SERVICIOS_CONFECCION_BORDADO: { nombre: 'Servicios de Confección / Bordado / Estampado', icono: '' },
  PAGO_MANO_DE_OBRA_TALLER: { nombre: 'Pago Mano de Obra / Confeccionistas / Talleres', icono: '' },
  SERVICIOS_COMERCIO_POS: { nombre: 'Servicios y Compras POS', icono: '' },
  GASTO_OPERATIVO_ALQUILER: { nombre: 'Gastos Operativos / Alquileres / Servicios Básicos', icono: '' },
  RETIRO_ATM_CAJA: { nombre: 'Retiros ATM / Cajas', icono: '' },
  CARGO_BANCARIO_IMPUESTO: { nombre: 'Cargos e Impuestos Bancarios', icono: '' },
  INGRESO_CONOCIDO: { nombre: 'Ingresos Conocidos / Recurrentes', icono: '' },
  GASTO_CONOCIDO: { nombre: 'Gastos / Pagos a Personas Conocidas', icono: '' },
  TRANSACCION_ANOMALA: { nombre: 'Transacción Anómala / Atípica', icono: '' },
  OTRO_SIN_CLASIFICAR: { nombre: 'Otros Movimientos / Varios', icono: '' },
};

// Almacenamiento en memoria
let memoriaMovimientos: MovimientoBancario[] = [];
let memoriaReglas: ReglaPersonaConocida[] = [];
let memoriaCategoriasCustom: CategoriaCustomMeta[] = [];

// Persistencia local en JSON
const BASE_DIR = path.resolve(__dirname, '..', '..');
const ARCHIVO_REGLAS = path.join(BASE_DIR, 'reglas_conocidas.json');
const ARCHIVO_CATEGORIAS = path.join(BASE_DIR, 'categorias_custom.json');

function cargarReglasDesdeDisco(): void {
  try {
    const posiblesRutas = [
      ARCHIVO_REGLAS,
      path.join(process.cwd(), 'packages', 'bank-analyzer', 'packages', 'bank-analyzer', 'reglas_conocidas.json'),
      path.join(process.cwd(), 'packages', 'bank-analyzer', 'reglas_conocidas.json'),
      path.join(process.cwd(), 'reglas_conocidas.json'),
    ];

    const rulesMap = new Map<string, ReglaPersonaConocida>();
    posiblesRutas.forEach((ruta) => {
      if (fs.existsSync(ruta)) {
        try {
          const data = fs.readFileSync(ruta, 'utf-8');
          const parsed: ReglaPersonaConocida[] = JSON.parse(data);
          if (Array.isArray(parsed)) {
            parsed.forEach((r) => {
              if (r && r.keyword) {
                const k = `${r.keyword.trim().toUpperCase()}_${r.tipoTransaccion || 'TODOS'}`;
                if (!rulesMap.has(k)) rulesMap.set(k, r);
              }
            });
          }
        } catch (err) {
          console.error(`Error leyendo reglas desde ${ruta}:`, err);
        }
      }
    });

    memoriaReglas = Array.from(rulesMap.values());
    console.log(`📋 Persistencia: ${memoriaReglas.length} reglas cargadas correctamente desde disco (${ARCHIVO_REGLAS})`);
    guardarReglasEnDisco();
  } catch (e) {
    console.error('Error al cargar reglas desde disco:', e);
  }
}

function guardarReglasEnDisco(): void {
  try {
    const dir = path.dirname(ARCHIVO_REGLAS);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ARCHIVO_REGLAS, JSON.stringify(memoriaReglas, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error al guardar reglas en disco:', e);
  }
}

function cargarCategoriasDesdeDisco(): void {
  try {
    const posiblesRutas = [
      ARCHIVO_CATEGORIAS,
      path.join(process.cwd(), 'packages', 'bank-analyzer', 'packages', 'bank-analyzer', 'categorias_custom.json'),
      path.join(process.cwd(), 'packages', 'bank-analyzer', 'categorias_custom.json'),
      path.join(process.cwd(), 'categorias_custom.json'),
    ];

    const catMap = new Map<string, CategoriaCustomMeta>();
    posiblesRutas.forEach((ruta) => {
      if (fs.existsSync(ruta)) {
        try {
          const data = fs.readFileSync(ruta, 'utf-8');
          const parsed: CategoriaCustomMeta[] = JSON.parse(data);
          if (Array.isArray(parsed)) {
            parsed.forEach((c) => {
              if (c && c.id && !catMap.has(c.id)) catMap.set(c.id, c);
            });
          }
        } catch (err) {
          console.error(`Error leyendo categorías desde ${ruta}:`, err);
        }
      }
    });

    memoriaCategoriasCustom = Array.from(catMap.values());
    console.log(`🏷️ Persistencia: ${memoriaCategoriasCustom.length} categorías custom cargadas desde disco`);
    guardarCategoriasEnDisco();
  } catch (e) {
    console.error('Error al cargar categorías custom desde disco:', e);
  }
}

function guardarCategoriasEnDisco(): void {
  try {
    const dir = path.dirname(ARCHIVO_CATEGORIAS);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ARCHIVO_CATEGORIAS, JSON.stringify(memoriaCategoriasCustom, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error al guardar categorías custom en disco:', e);
  }
}

// Inicialización
cargarReglasDesdeDisco();
cargarCategoriasDesdeDisco();

export function obtenerMetaCategoria(catKey: string): { nombre: string; icono: string } {
  if (CATEGORIA_META[catKey]) {
    return CATEGORIA_META[catKey];
  }
  const custom = memoriaCategoriasCustom.find(
    (c) => c.id === catKey || c.nombreVisible.toLowerCase().trim() === catKey.toLowerCase().trim()
  );
  if (custom) {
    return { nombre: custom.nombreVisible, icono: custom.icono };
  }
  return { nombre: catKey, icono: '🏷️' };
}

export function obtenerCategoriasTotales(): CategoriaCustomMeta[] {
  const predefinidas: CategoriaCustomMeta[] = Object.entries(CATEGORIA_META).map(([id, meta]) => ({
    id,
    nombreVisible: meta.nombre,
    icono: meta.icono,
    tipo: id.startsWith('VENTA') || id.startsWith('ROPA') || id.startsWith('SERVICIOS_CONF') || id.startsWith('INGRESO') ? 'INGRESO' : 'AMBOS',
    esCustom: false,
  }));

  return [...predefinidas, ...memoriaCategoriasCustom];
}

export function crearCategoriaCustom(nombreVisible: string, tipo: 'INGRESO' | 'EGRESO' | 'AMBOS' = 'AMBOS', icono = '🏷️'): CategoriaCustomMeta {
  const idNorm = `cat_custom_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const nuevaCat: CategoriaCustomMeta = {
    id: idNorm,
    nombreVisible: nombreVisible.trim(),
    icono: icono.trim() || '🏷️',
    tipo,
    esCustom: true,
    creadoEn: new Date().toISOString(),
  };

  memoriaCategoriasCustom.push(nuevaCat);
  guardarCategoriasEnDisco();
  return nuevaCat;
}

export function obtenerReglas(): ReglaPersonaConocida[] {
  return memoriaReglas;
}

export function guardarRegla(regla: Omit<ReglaPersonaConocida, 'id' | 'creadoEn'>): ReglaPersonaConocida {
  const nuevaRegla: ReglaPersonaConocida = {
    ...regla,
    id: `rule_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    creadoEn: new Date().toISOString(),
  };
  memoriaReglas.push(nuevaRegla);
  guardarReglasEnDisco();
  reaplicarReglasAMovimientos();
  return nuevaRegla;
}

export function guardarReglasLote(reglas: Omit<ReglaPersonaConocida, 'id' | 'creadoEn'>[]): ReglaPersonaConocida[] {
  const creadas: ReglaPersonaConocida[] = [];
  reglas.forEach((regla) => {
    const nuevaRegla: ReglaPersonaConocida = {
      ...regla,
      id: `rule_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      creadoEn: new Date().toISOString(),
    };
    memoriaReglas.push(nuevaRegla);
    creadas.push(nuevaRegla);
  });
  guardarReglasEnDisco();
  reaplicarReglasAMovimientos();
  return creadas;
}

export function eliminarRegla(id: string): boolean {
  const prevLen = memoriaReglas.length;
  memoriaReglas = memoriaReglas.filter((r) => r.id !== id);
  if (memoriaReglas.length !== prevLen) {
    guardarReglasEnDisco();
    reaplicarReglasAMovimientos();
    return true;
  }
  return false;
}

export function extraerBancoContraparte(glosa: string = '', contraparteBancoRaw: string = '', miBanco: string = ''): string {
  if (contraparteBancoRaw && contraparteBancoRaw.trim().length >= 3) {
    return contraparteBancoRaw.trim();
  }
  const text = `${glosa} ${contraparteBancoRaw}`.toUpperCase();

  const matchBco = text.match(/(?:Banco|BANCO)\s*:?\s*([^;,|\n]+)/i);
  if (matchBco && matchBco[1].trim().length >= 3) {
    return matchBco[1].trim();
  }

  if (text.includes('BANCO DE CREDITO') || text.includes('BCP')) return 'BANCO DE CREDITO';
  if (text.includes('BANCO BISA') || text.includes('BISA')) return 'BANCO BISA';
  if (text.includes('BANCO GANADERO') || text.includes('GANADERO')) return 'BANCO GANADERO';
  if (text.includes('BANCO MERCANTIL') || text.includes('BMSC')) return 'BANCO MERCANTIL';
  if (text.includes('BANCO UNION') || text.includes('UNION')) return 'BANCO UNIÓN';
  if (text.includes('JESUS NAZARENO') || text.includes('NAZARENO')) return 'COOP. JESUS NAZARENO';
  if (text.includes('BANCO SOL') || text.includes('B-SOL')) return 'BANCO SOL';
  if (text.includes('BANCO FIE') || text.includes('FIE')) return 'BANCO FIE';
  if (text.includes('BANCO PRODEM') || text.includes('PRODEM')) return 'BANCO PRODEM';
  if (text.includes('BANCO ECOFUTURO') || text.includes('ECOFUTURO')) return 'BANCO ECOFUTURO';
  if (text.includes('BNB') || text.includes('BANCO NACIONAL')) return 'BANCO NACIONAL (BNB)';

  return miBanco ? `${miBanco} (Traspaso Directo)` : 'Traspaso Directo';
}

export function normalizarNombreContraparte(rawName: string, glosa: string = ''): string {
  let str = rawName || '';

  // Extraer el nombre si viene con prefijos comunes
  const matchNom = str.match(/(?:NOMBRE\(S\)|Nombre|NOMBRE)\s*:?\s*([^;,.|\n]+)/i);
  if (matchNom && matchNom[1].trim().length > 2) {
    str = matchNom[1].trim();
  }

  // Quitar la parte de Banco:..., Cuenta:..., Doc.ID:... etc.
  str = str.replace(/Banco\s*:?\s*[^;,|\n]+/gi, '');
  str = str.replace(/(?:CUENTA|Cuenta|Cuenta Origen|Cuenta Destino)\s*:?\s*\d+/gi, '');
  str = str.replace(/Doc\.ID\s*:?\s*\d+/gi, '');
  str = str.replace(/N\/C POR TRASPASO ENTRE BANCOS ACH/gi, '');
  str = str.replace(/N\/D RETIRO CAJA AHORRO \(CJ\)/gi, '');
  str = str.replace(/BM QR INTERBANCARIA/gi, '');

  // Normalizar acentos
  str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Limpiar caracteres raros sobrantes
  str = str.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
  str = str.replace(/\s+/g, ' ').trim().toUpperCase();

  if (!str || str.length < 3) return (rawName || 'CLIENTE / PROVEEDOR GENERAL').toUpperCase().trim();
  return str;
}

export function evaluarCoincidenciaRegla(r: ReglaPersonaConocida, m: MovimientoBancario): boolean {
  // 1. Filtro por Tipo de transacción
  if (r.tipoTransaccion && r.tipoTransaccion !== 'TODOS' && r.tipoTransaccion !== m.tipo) {
    return false;
  }

  // 2. Filtro por Mi Cuenta (sólo si se especificó explícitamente y no es TODOS)
  if (r.banco && r.banco.trim() !== '' && r.banco.toUpperCase() !== 'TODOS' && r.banco.toUpperCase() !== m.banco.toUpperCase()) {
    return false;
  }

  const nombreNorm = normalizarNombreContraparte(m.contraparteNombre, m.glosaDetalle || '');
  const cNombre = (m.contraparteNombre || '').toUpperCase();
  const textFull = `${m.contraparteNombre || ''} ${m.glosaDetalle || ''} ${m.descripcionRaw || ''}`.toUpperCase();

  // 3. Filtro por Persona / Keyword
  let coincideKeyword = false;
  if (r.keyword && r.keyword.trim() !== '') {
    const kw = r.keyword.trim().toUpperCase();
    const normKw = normalizarNombreContraparte(kw);

    coincideKeyword =
      cNombre.includes(kw) ||
      nombreNorm.includes(kw) ||
      textFull.includes(kw) ||
      (normKw.length >= 3 && (nombreNorm.includes(normKw) || normKw.includes(nombreNorm)));

    if (!coincideKeyword) return false;
  }

  // 4. Filtro por Banco Contraparte / Origen (sólo si la regla NO es por Persona o si no hubo keyword)
  if (!r.keyword && r.bancoContraparte && r.bancoContraparte.trim() !== '' && r.bancoContraparte.toUpperCase() !== 'TODOS') {
    const bKw = r.bancoContraparte.trim().toUpperCase();
    const cBanco = (m.contraparteBanco || '').toUpperCase();
    const coincideBancoContraparte = cBanco.includes(bKw) || textFull.includes(bKw);
    if (!coincideBancoContraparte) return false;
  }

  return true;
}

export function reaplicarReglasAMovimientos(): void {
  memoriaMovimientos.forEach((m) => {
    const clasif = clasificarTransaccion(
      m.montoBs,
      m.tipo,
      m.contraparteNombre,
      m.glosaDetalle,
      m.descripcionRaw,
      memoriaReglas,
      m.banco,
      m.contraparteBanco
    );
    m.categoria = clasif.categoria;
    m.esAnomalo = clasif.esAnomalo;
    m.motivoAnomalia = clasif.motivoAnomalia;
  });
}

export function guardarMovimientos(movs: MovimientoBancario[], append = false): void {
  if (!append) {
    memoriaMovimientos = [...movs];
  } else {
    // Evitar duplicados por id
    const setIds = new Set(memoriaMovimientos.map((m) => m.id));
    movs.forEach((m) => {
      if (!setIds.has(m.id)) {
        memoriaMovimientos.push(m);
        setIds.add(m.id);
      }
    });
  }

  // Re-aplicar reglas custom vigentes
  reaplicarReglasAMovimientos();

  // Ordenar cronológicamente descendente (más reciente a más antiguo)
  memoriaMovimientos.sort((a, b) => {
    const cmpDate = b.fechaIso.localeCompare(a.fechaIso);
    if (cmpDate !== 0) return cmpDate;
    const cmpTime = b.hora.localeCompare(a.hora);
    if (cmpTime !== 0) return cmpTime;
    return (b.ordenOriginal || 0) - (a.ordenOriginal || 0);
  });
}

export function vaciarMovimientos(): void {
  memoriaMovimientos = [];
}

export function obtenerMovimientosGuardados(): MovimientoBancario[] {
  return memoriaMovimientos;
}

export function obtenerMetadataResumen(fechaDesde?: string, fechaHasta?: string): {
  totalMovimientos: number;
  totalMovimientosIngreso: number;
  totalMovimientosEgreso: number;
  bancosDetectados: string[];
  fechaMin: string;
  fechaMax: string;
  totalIngresosBs: number;
  totalEgresosBs: number;
  balanceNetoBs: number;
  totalAnomalias: number;
  archivosCargados: string[];
  cuentasDetalle: {
    banco: string;
    nroCuenta: string;
    titularNombre: string;
    saldoInicialBs: number;
    totalIngresosBs: number;
    totalEgresosBs: number;
    balanceNetoBs: number;
    saldoFinalBs: number;
    conciliadoOk: boolean;
  }[];
} {
  if (memoriaMovimientos.length === 0) {
    return {
      totalMovimientos: 0,
      totalMovimientosIngreso: 0,
      totalMovimientosEgreso: 0,
      bancosDetectados: [],
      fechaMin: '-',
      fechaMax: '-',
      totalIngresosBs: 0,
      totalEgresosBs: 0,
      balanceNetoBs: 0,
      totalAnomalias: 0,
      archivosCargados: [],
      cuentasDetalle: [],
    };
  }

  let list = [...memoriaMovimientos];
  if (fechaDesde) {
    list = list.filter((m) => m.fechaIso >= fechaDesde);
  }
  if (fechaHasta) {
    list = list.filter((m) => m.fechaIso <= fechaHasta);
  }

  const setBancos = new Set<string>();
  const setArchivos = new Set<string>();
  let totalIngresosBs = 0;
  let totalEgresosBs = 0;
  let totalAnomalias = 0;
  let totalMovimientosIngreso = 0;
  let totalMovimientosEgreso = 0;

  // Agrupar por cuenta de banco usando TODOS los movimientos para calcular saldos reales
  const mapaCuentasTodas: Record<string, MovimientoBancario[]> = {};
  memoriaMovimientos.forEach((m) => {
    setBancos.add(m.banco);
    if (m.archivoOrigen) setArchivos.add(m.archivoOrigen);
    const cKey = `${m.banco}_${m.nroCuentaTitular}`;
    if (!mapaCuentasTodas[cKey]) mapaCuentasTodas[cKey] = [];
    mapaCuentasTodas[cKey].push(m);
  });

  list.forEach((m) => {
    const val = m.esReversion ? -m.montoBs : m.montoBs;
    if (m.tipo === 'INGRESO') {
      totalIngresosBs += val;
      totalMovimientosIngreso++;
    } else {
      totalEgresosBs += val;
      totalMovimientosEgreso++;
    }
    if (m.esAnomalo) totalAnomalias++;
  });

  const cuentasDetalle = Object.entries(mapaCuentasTodas).map(([cKey, movs]) => {
    const asc = [...movs].sort((a, b) => {
      const cmpDate = a.fechaIso.localeCompare(b.fechaIso);
      if (cmpDate !== 0) return cmpDate;
      const cmpTime = a.hora.localeCompare(b.hora);
      if (cmpTime !== 0) return cmpTime;
      return (a.ordenOriginal || 0) - (b.ordenOriginal || 0);
    });

    const movOldestAbsolute = asc[0];
    const oldestVal = movOldestAbsolute.esReversion ? -movOldestAbsolute.montoBs : movOldestAbsolute.montoBs;
    let baseSaldoInicialBs = movOldestAbsolute.tipo === 'INGRESO' ? movOldestAbsolute.saldoBs - oldestVal : movOldestAbsolute.saldoBs + oldestVal;
    baseSaldoInicialBs = Math.round(baseSaldoInicialBs * 100) / 100;

    let movsPrevios = asc;
    let movsEnRango = asc;

    if (fechaDesde) {
      movsPrevios = asc.filter((m) => m.fechaIso < fechaDesde);
      movsEnRango = movsEnRango.filter((m) => m.fechaIso >= fechaDesde);
    }
    if (fechaHasta) {
      movsEnRango = movsEnRango.filter((m) => m.fechaIso <= fechaHasta);
    }

    let sInicial = baseSaldoInicialBs;
    if (fechaDesde) {
      movsPrevios.forEach((m) => {
        const val = m.esReversion ? -m.montoBs : m.montoBs;
        if (m.tipo === 'INGRESO') sInicial += val;
        else sInicial -= val;
      });
    }

    let ingAcc = 0;
    let egrAcc = 0;
    movsEnRango.forEach((m) => {
      const val = m.esReversion ? -m.montoBs : m.montoBs;
      if (m.tipo === 'INGRESO') ingAcc += val;
      else egrAcc += val;
    });

    sInicial = Math.round(sInicial * 100) / 100;
    ingAcc = Math.round(ingAcc * 100) / 100;
    egrAcc = Math.round(egrAcc * 100) / 100;
    const bNeto = Math.round((ingAcc - egrAcc) * 100) / 100;
    const sFinal = Math.round((sInicial + bNeto) * 100) / 100;
    const conc = true;

    return {
      banco: movOldestAbsolute.banco,
      nroCuenta: movOldestAbsolute.nroCuentaTitular,
      titularNombre: obtenerNombreTitularNormalizado(movOldestAbsolute.banco, movOldestAbsolute.titularNombre),
      saldoInicialBs: sInicial,
      totalIngresosBs: ingAcc,
      totalEgresosBs: egrAcc,
      balanceNetoBs: bNeto,
      saldoFinalBs: sFinal,
      conciliadoOk: conc,
    };
  });

  const fechaMin = list.length > 0 ? list[list.length - 1].fechaTexto : '-';
  const fechaMax = list.length > 0 ? list[0].fechaTexto : '-';
  totalIngresosBs = Math.round(totalIngresosBs * 100) / 100;
  totalEgresosBs = Math.round(totalEgresosBs * 100) / 100;
  const balanceNetoBs = Math.round((totalIngresosBs - totalEgresosBs) * 100) / 100;

  return {
    totalMovimientos: list.length,
    totalMovimientosIngreso,
    totalMovimientosEgreso,
    bancosDetectados: Array.from(setBancos),
    fechaMin,
    fechaMax,
    totalIngresosBs,
    totalEgresosBs,
    balanceNetoBs,
    totalAnomalias,
    archivosCargados: Array.from(setArchivos),
    cuentasDetalle,
  };
}

export function obtenerMovimientosFiltrados(params: {
  banco?: string;
  tipo?: string;
  categoria?: string;
  anomaloOnly?: boolean;
  fechaInicio?: string;
  fechaFin?: string;
  search?: string;
  page?: number;
  limit?: number;
}): { data: MovimientoBancario[]; total: number; page: number; totalPages: number } {
  let list = [...memoriaMovimientos];

  if (params.banco && params.banco.trim() !== '') {
    list = list.filter((m) => m.banco.toLowerCase() === params.banco!.toLowerCase());
  }

  if (params.tipo && params.tipo.trim() !== '') {
    list = list.filter((m) => m.tipo.toLowerCase() === params.tipo!.toLowerCase());
  }

  if (params.categoria && params.categoria.trim() !== '') {
    list = list.filter((m) => m.categoria === params.categoria);
  }

  if (params.anomaloOnly) {
    list = list.filter((m) => {
      if (!m.esAnomalo) return false;
      const yaTieneRegla = memoriaReglas.some((r) => evaluarCoincidenciaRegla(r, m));
      return !yaTieneRegla;
    });
  }

  if (params.fechaInicio) {
    list = list.filter((m) => m.fechaIso >= params.fechaInicio!);
  }

  if (params.fechaFin) {
    list = list.filter((m) => m.fechaIso <= params.fechaFin!);
  }

  if (params.search && params.search.trim() !== '') {
    const q = params.search.toLowerCase().trim();
    list = list.filter(
      (m) =>
        m.contraparteNombre.toLowerCase().includes(q) ||
        m.glosaDetalle.toLowerCase().includes(q) ||
        m.descripcionRaw.toLowerCase().includes(q) ||
        m.montoBs.toString().includes(q)
    );
  }

  const total = list.length;
  const page = Math.max(1, params.page || 1);
  const limit = Math.max(10, params.limit || 25);
  const totalPages = Math.ceil(total / limit) || 1;
  const startIndex = (page - 1) * limit;

  const data = list.slice(startIndex, startIndex + limit);

  return { data, total, page, totalPages };
}

export function obtenerRecurrentes(tipo?: 'INGRESO' | 'EGRESO', limit = 15, fechaDesde?: string, fechaHasta?: string): ContraparteRecurrenteItem[] {
  let list = [...memoriaMovimientos];
  if (tipo) {
    list = list.filter((m) => m.tipo === tipo);
  }
  if (fechaDesde) {
    list = list.filter((m) => m.fechaIso >= fechaDesde);
  }
  if (fechaHasta) {
    list = list.filter((m) => m.fechaIso <= fechaHasta);
  }

  const mapa: Record<
    string,
    {
      nombre: string;
      banco: string;
      tipo: 'INGRESO' | 'EGRESO';
      count: number;
      sumMonto: number;
      categoriasCount: Record<string, number>;
    }
  > = {};

  list.forEach((m) => {
    const key = `${m.contraparteNombre.toLowerCase().trim()}_${m.tipo}`;
    if (!mapa[key]) {
      mapa[key] = {
        nombre: m.contraparteNombre,
        banco: m.contraparteBanco || m.banco,
        tipo: m.tipo,
        count: 0,
        sumMonto: 0,
        categoriasCount: {},
      };
    }

    mapa[key].count++;
    mapa[key].sumMonto += m.montoBs;
    mapa[key].categoriasCount[m.categoria] = (mapa[key].categoriasCount[m.categoria] || 0) + 1;
  });

  const res: ContraparteRecurrenteItem[] = Object.values(mapa).map((item) => {
    let topCat: CategoriaTransaccion = 'OTRO_SIN_CLASIFICAR';
    let maxCatCount = 0;
    Object.entries(item.categoriasCount).forEach(([cat, cnt]) => {
      if (cnt > maxCatCount) {
        maxCatCount = cnt;
        topCat = cat as CategoriaTransaccion;
      }
    });

    return {
      contraparteNombre: item.nombre,
      banco: item.banco,
      tipo: item.tipo,
      cantidadTransacciones: item.count,
      totalMontoBs: Math.round(item.sumMonto * 100) / 100,
      promedioBs: Math.round((item.sumMonto / item.count) * 100) / 100,
      categoriaPrincipal: topCat,
    };
  });

  return res.sort((a, b) => b.totalMontoBs - a.totalMontoBs).slice(0, limit);
}

export function obtenerResumenMensualClasificado(anioFiltro?: number, fechaDesde?: string, fechaHasta?: string): ResumenMensualClasificado[] {
  let list = [...memoriaMovimientos];
  if (anioFiltro) {
    list = list.filter((m) => m.anio === anioFiltro);
  }
  if (fechaDesde) {
    list = list.filter((m) => m.fechaIso >= fechaDesde);
  }
  if (fechaHasta) {
    list = list.filter((m) => m.fechaIso <= fechaHasta);
  }

  // Agrupar por mes (YYYY-MM)
  const mapaMes: Record<
    string,
    {
      anio: number;
      mes: number;
      ingresos: MovimientoBancario[];
      egresos: MovimientoBancario[];
    }
  > = {};

  list.forEach((m) => {
    const key = `${m.anio}_${String(m.mes).padStart(2, '0')}`;
    if (!mapaMes[key]) {
      mapaMes[key] = { anio: m.anio, mes: m.mes, ingresos: [], egresos: [] };
    }
    if (m.tipo === 'INGRESO') mapaMes[key].ingresos.push(m);
    else mapaMes[key].egresos.push(m);
  });

  const keysOrdenadas = Object.keys(mapaMes).sort(); // cronológico ascendente

  return keysOrdenadas.map((key) => {
    const item = mapaMes[key];
    let totalIngresosBs = 0;
    let totalEgresosBs = 0;

    const mapIngresosCat: Record<string, { cant: number; monto: number; detalles: any[] }> = {};
    const mapEgresosCat: Record<string, { cant: number; monto: number; detalles: any[] }> = {};

    item.ingresos.forEach((m) => {
      totalIngresosBs += m.montoBs;
      if (!mapIngresosCat[m.categoria]) mapIngresosCat[m.categoria] = { cant: 0, monto: 0, detalles: [] };
      mapIngresosCat[m.categoria].cant++;
      mapIngresosCat[m.categoria].monto += m.montoBs;
      mapIngresosCat[m.categoria].detalles.push({
        fechaTexto: m.fechaTexto,
        contraparteNombre: m.contraparteNombre,
        montoBs: m.montoBs,
        motivo: m.motivoAnomalia || m.glosaDetalle,
        banco: m.banco,
        contraparteBanco: extraerBancoContraparte(m.glosaDetalle || m.descripcionRaw, m.contraparteBanco, m.banco),
        tipo: m.tipo,
      });
    });

    item.egresos.forEach((m) => {
      totalEgresosBs += m.montoBs;
      if (!mapEgresosCat[m.categoria]) mapEgresosCat[m.categoria] = { cant: 0, monto: 0, detalles: [] };
      mapEgresosCat[m.categoria].cant++;
      mapEgresosCat[m.categoria].monto += m.montoBs;
      mapEgresosCat[m.categoria].detalles.push({
        fechaTexto: m.fechaTexto,
        contraparteNombre: m.contraparteNombre,
        montoBs: m.montoBs,
        motivo: m.motivoAnomalia || m.glosaDetalle,
        banco: m.banco,
        contraparteBanco: extraerBancoContraparte(m.glosaDetalle || m.descripcionRaw, m.contraparteBanco, m.banco),
        tipo: m.tipo,
      });
    });

    const ingresosPorCategoria: CategoriaResumenItem[] = Object.keys(mapIngresosCat).map((catKey) => {
      const cat = catKey as CategoriaTransaccion;
      const mVal = Math.round(mapIngresosCat[catKey].monto * 100) / 100;
      const pct = totalIngresosBs > 0 ? Math.round((mVal / totalIngresosBs) * 1000) / 10 : 0;
      const meta = obtenerMetaCategoria(catKey);

      return {
        categoria: cat,
        nombreVisible: meta.nombre,
        icono: meta.icono,
        cantidad: mapIngresosCat[catKey].cant,
        montoBs: mVal,
        pctDelTotal: pct,
        detalles: mapIngresosCat[catKey].detalles,
      };
    }).sort((a, b) => b.montoBs - a.montoBs);

    const egresosPorCategoria: CategoriaResumenItem[] = Object.keys(mapEgresosCat).map((catKey) => {
      const cat = catKey as CategoriaTransaccion;
      const mVal = Math.round(mapEgresosCat[catKey].monto * 100) / 100;
      const pct = totalEgresosBs > 0 ? Math.round((mVal / totalEgresosBs) * 1000) / 10 : 0;
      const meta = obtenerMetaCategoria(catKey);

      return {
        categoria: cat,
        nombreVisible: meta.nombre,
        icono: meta.icono,
        cantidad: mapEgresosCat[catKey].cant,
        montoBs: mVal,
        pctDelTotal: pct,
        detalles: mapEgresosCat[catKey].detalles,
      };
    }).sort((a, b) => b.montoBs - a.montoBs);

    // Anomalías del mes
    const todosMovsMes = [...item.ingresos, ...item.egresos];
    const anomalias: AnomaliaDetectadaItem[] = todosMovsMes
      .filter((m) => m.esAnomalo)
      .map((m) => ({
        movimiento: m,
        motivo: m.motivoAnomalia || 'Monto atípico abultado',
        nivelRiesgo: m.montoBs >= 5000 ? 'ALTO' : 'MEDIO',
      }));

    // Top contrapartes del mes
    const mapaContraparteMes: Record<string, { nombre: string; banco: string; tipo: 'INGRESO' | 'EGRESO'; cant: number; monto: number; cat: CategoriaTransaccion }> = {};
    todosMovsMes.forEach((m) => {
      const cKey = `${m.contraparteNombre}_${m.tipo}`;
      if (!mapaContraparteMes[cKey]) {
        mapaContraparteMes[cKey] = {
          nombre: m.contraparteNombre,
          banco: m.contraparteBanco || m.banco,
          tipo: m.tipo,
          cant: 0,
          monto: 0,
          cat: m.categoria,
        };
      }
      mapaContraparteMes[cKey].cant++;
      mapaContraparteMes[cKey].monto += m.montoBs;
    });

    const topContrapartes: ContraparteRecurrenteItem[] = Object.values(mapaContraparteMes)
      .map((c) => ({
        contraparteNombre: c.nombre,
        banco: c.banco,
        tipo: c.tipo,
        cantidadTransacciones: c.cant,
        totalMontoBs: Math.round(c.monto * 100) / 100,
        promedioBs: Math.round((c.monto / c.cant) * 100) / 100,
        categoriaPrincipal: c.cat,
      }))
      .sort((a, b) => b.totalMontoBs - a.totalMontoBs)
      .slice(0, 5);

    const nombreMesTxt = NOMBRE_MESES[item.mes] || `Mes ${item.mes}`;

    return {
      periodoTexto: `${nombreMesTxt} ${item.anio}`,
      anio: item.anio,
      mesNum: item.mes,
      totalIngresosBs: Math.round(totalIngresosBs * 100) / 100,
      totalEgresosBs: Math.round(totalEgresosBs * 100) / 100,
      balanceMesBs: Math.round((totalIngresosBs - totalEgresosBs) * 100) / 100,
      totalTransacciones: todosMovsMes.length,
      ingresosPorCategoria,
      egresosPorCategoria,
      topContrapartes,
      anomalias,
    };
  });
}

// ----------------------------------------------------------------------
// GENERACIÓN DE REPORTES EN ESTILO "12.0 Respaldo bancario resumen de cuentas"
// ----------------------------------------------------------------------
export interface RespaldoCuentaMesItem {
  mesTexto: string;
  anioMes: string;
  creditosBs: number;
  debitosBs: number;
  saldoBs: number;
}

export interface RespaldoCuentaBancaria {
  banco: string;
  nroCuenta: string;
  titularNombre: string;
  saldoInicialBs: number;
  fechaInicialTexto: string;
  filasMensuales: RespaldoCuentaMesItem[];
  totalCreditosBs: number;
  totalDebitosBs: number;
  saldoFinalBs: number;
}

export interface RespaldoComparativoMes {
  mesTexto: string;
  anioMes: string;
  egresosPorBanco: Record<string, number>;
  totalEgresosMensualBs: number;
  totalIngresosMensualBs: number;
}

export interface RespaldoGeneralConsolidado {
  saldoInicialTotalBs: number;
  fechaInicialTexto: string;
  filasMensuales: RespaldoCuentaMesItem[];
  totalCreditosBs: number;
  totalDebitosBs: number;
  saldoFinalBs: number;
}

export interface RespaldoGeneralReporte {
  cuentas: RespaldoCuentaBancaria[];
  comparativoMeses: RespaldoComparativoMes[];
  resumenConsolidado?: RespaldoGeneralConsolidado;
}

export function obtenerRespaldoResumenCuentas(fechaDesde?: string, fechaHasta?: string): RespaldoGeneralReporte {
  if (memoriaMovimientos.length === 0) {
    return { cuentas: [], comparativoMeses: [] };
  }

  const mapaCuentas: Record<string, MovimientoBancario[]> = {};
  memoriaMovimientos.forEach((m) => {
    const cKey = `${m.banco}_${m.nroCuentaTitular}`;
    if (!mapaCuentas[cKey]) mapaCuentas[cKey] = [];
    mapaCuentas[cKey].push(m);
  });

  const NOMBRES_MES_CORTOS: Record<number, string> = {
    1: 'ene', 2: 'feb', 3: 'mar', 4: 'abr', 5: 'may', 6: 'jun',
    7: 'jul', 8: 'ago', 9: 'sep', 10: 'oct', 11: 'nov', 12: 'dic',
  };

  function formatFechaIsoTexto(isoDate: string): string {
    const parts = isoDate.split('-');
    if (parts.length < 3) return isoDate;
    const y = parts[0];
    const m = parseInt(parts[1], 10);
    const d = parts[2];
    const mesStr = NOMBRES_MES_CORTOS[m] || `mes ${m}`;
    return `${d}/${mesStr}/${y}`;
  }

  const cuentas: RespaldoCuentaBancaria[] = Object.entries(mapaCuentas).map(([cKey, movs]) => {
    const asc = [...movs].sort((a, b) => {
      const cmpDate = a.fechaIso.localeCompare(b.fechaIso);
      if (cmpDate !== 0) return cmpDate;
      const cmpTime = a.hora.localeCompare(b.hora);
      if (cmpTime !== 0) return cmpTime;
      return (a.ordenOriginal || 0) - (b.ordenOriginal || 0);
    });
    const movOldestAbsolute = asc[0];

    const oldestVal = movOldestAbsolute.esReversion ? -movOldestAbsolute.montoBs : movOldestAbsolute.montoBs;
    let baseSaldoInicialBs = movOldestAbsolute.tipo === 'INGRESO' ? movOldestAbsolute.saldoBs - oldestVal : movOldestAbsolute.saldoBs + oldestVal;
    baseSaldoInicialBs = Math.round(baseSaldoInicialBs * 100) / 100;

    let movsPrevios = asc;
    let movsEnRango = asc;

    if (fechaDesde) {
      movsPrevios = asc.filter((m) => m.fechaIso < fechaDesde);
      movsEnRango = movsEnRango.filter((m) => m.fechaIso >= fechaDesde);
    }
    if (fechaHasta) {
      movsEnRango = movsEnRango.filter((m) => m.fechaIso <= fechaHasta);
    }

    let saldoInicialEnRango = baseSaldoInicialBs;
    if (fechaDesde) {
      movsPrevios.forEach((m) => {
        const val = m.esReversion ? -m.montoBs : m.montoBs;
        if (m.tipo === 'INGRESO') saldoInicialEnRango += val;
        else saldoInicialEnRango -= val;
      });
    }
    saldoInicialEnRango = Math.round(saldoInicialEnRango * 100) / 100;

    const mapMeses: Record<string, { anio: number; mes: number; creditos: number; debitos: number }> = {};
    movsEnRango.forEach((m) => {
      const ym = `${m.anio}-${String(m.mes).padStart(2, '0')}`;
      if (!mapMeses[ym]) {
        mapMeses[ym] = { anio: m.anio, mes: m.mes, creditos: 0, debitos: 0 };
      }
      const val = m.esReversion ? -m.montoBs : m.montoBs;
      if (m.tipo === 'INGRESO') mapMeses[ym].creditos += val;
      else mapMeses[ym].debitos += val;
    });

    const ymKeys = Object.keys(mapMeses).sort();
    let saldoCorrido = saldoInicialEnRango;
    let totalCreditosBs = 0;
    let totalDebitosBs = 0;

    const filasMensuales: RespaldoCuentaMesItem[] = ymKeys.map((ym) => {
      const item = mapMeses[ym];
      const cred = Math.round(item.creditos * 100) / 100;
      const deb = Math.round(item.debitos * 100) / 100;
      saldoCorrido = Math.round((saldoCorrido + cred - deb) * 100) / 100;

      totalCreditosBs += cred;
      totalDebitosBs += deb;

      const mNum = typeof item.mes === 'number' ? item.mes : parseInt(String(item.mes), 10);
      const mesShort = NOMBRES_MES_CORTOS[mNum] || `mes ${mNum}`;
      const mesTexto = `${mesShort} ${item.anio}`;

      return {
        mesTexto,
        anioMes: ym,
        creditosBs: cred,
        debitosBs: deb,
        saldoBs: saldoCorrido,
      };
    });

    const refMov = movsEnRango[0] || movOldestAbsolute;
    const fechaInicialStr = fechaDesde ? formatFechaIsoTexto(fechaDesde) : formatFechaIsoTexto(movOldestAbsolute.fechaIso);

    return {
      banco: movOldestAbsolute.banco,
      nroCuenta: movOldestAbsolute.nroCuentaTitular,
      titularNombre: obtenerNombreTitularNormalizado(movOldestAbsolute.banco, movOldestAbsolute.titularNombre),
      saldoInicialBs: saldoInicialEnRango,
      fechaInicialTexto: fechaInicialStr,
      filasMensuales,
      totalCreditosBs: Math.round(totalCreditosBs * 100) / 100,
      totalDebitosBs: Math.round(totalDebitosBs * 100) / 100,
      saldoFinalBs: saldoCorrido,
    };
  });

  const mapComparativoMeses: Record<string, { mesTexto: string; egresos: Record<string, number>; ingresos: Record<string, number> }> = {};

  cuentas.forEach((c) => {
    c.filasMensuales.forEach((f) => {
      if (!mapComparativoMeses[f.anioMes]) {
        mapComparativoMeses[f.anioMes] = {
          mesTexto: f.mesTexto,
          egresos: {},
          ingresos: {},
        };
      }
      mapComparativoMeses[f.anioMes].egresos[c.banco] = (mapComparativoMeses[f.anioMes].egresos[c.banco] || 0) + f.debitosBs;
      mapComparativoMeses[f.anioMes].ingresos[c.banco] = (mapComparativoMeses[f.anioMes].ingresos[c.banco] || 0) + f.creditosBs;
    });
  });

  const comparativoMeses: RespaldoComparativoMes[] = Object.keys(mapComparativoMeses)
    .sort()
    .map((ym) => {
      const item = mapComparativoMeses[ym];
      let totEgr = 0;
      let totIng = 0;
      Object.values(item.egresos).forEach((v) => (totEgr += v));
      Object.values(item.ingresos).forEach((v) => (totIng += v));

      return {
        mesTexto: item.mesTexto,
        anioMes: ym,
        egresosPorBanco: item.egresos,
        ingresosPorBanco: item.ingresos,
        totalEgresosMensualBs: Math.round(totEgr * 100) / 100,
        totalIngresosMensualBs: Math.round(totIng * 100) / 100,
      };
    });

  // Calcular Resumen General Consolidado para TODOS los Bancos
  const saldoInicialTotalBs = Math.round(cuentas.reduce((sum, c) => sum + c.saldoInicialBs, 0) * 100) / 100;
  const mapaMesesConsolidado: Record<string, { mesTexto: string; creditos: number; debitos: number }> = {};

  cuentas.forEach((c) => {
    c.filasMensuales.forEach((f) => {
      if (!mapaMesesConsolidado[f.anioMes]) {
        mapaMesesConsolidado[f.anioMes] = { mesTexto: f.mesTexto, creditos: 0, debitos: 0 };
      }
      mapaMesesConsolidado[f.anioMes].creditos += f.creditosBs;
      mapaMesesConsolidado[f.anioMes].debitos += f.debitosBs;
    });
  });

  const ymKeysConsol = Object.keys(mapaMesesConsolidado).sort();
  let saldoCorridoConsol = saldoInicialTotalBs;
  let totalCreditosConsol = 0;
  let totalDebitosConsol = 0;

  const filasMensualesConsol: RespaldoCuentaMesItem[] = ymKeysConsol.map((ym) => {
    const item = mapaMesesConsolidado[ym];
    const cred = Math.round(item.creditos * 100) / 100;
    const deb = Math.round(item.debitos * 100) / 100;
    saldoCorridoConsol = Math.round((saldoCorridoConsol + cred - deb) * 100) / 100;
    totalCreditosConsol += cred;
    totalDebitosConsol += deb;

    return {
      mesTexto: item.mesTexto,
      anioMes: ym,
      creditosBs: cred,
      debitosBs: deb,
      saldoBs: saldoCorridoConsol,
    };
  });

  const fechaInicialTextoConsol = fechaDesde ? formatFechaIsoTexto(fechaDesde) : (cuentas[0] ? cuentas[0].fechaInicialTexto : '');

  const resumenConsolidado: RespaldoGeneralConsolidado = {
    saldoInicialTotalBs,
    fechaInicialTexto: fechaInicialTextoConsol,
    filasMensuales: filasMensualesConsol,
    totalCreditosBs: Math.round(totalCreditosConsol * 100) / 100,
    totalDebitosBs: Math.round(totalDebitosConsol * 100) / 100,
    saldoFinalBs: saldoCorridoConsol,
  };

  return { cuentas, comparativoMeses, resumenConsolidado };
}

export function obtenerSugerenciasClasificacion(): {
  sugerenciasGrandesAnomalas: {
    contraparteNombre: string;
    banco: string;
    contraparteBanco: string;
    tipo: 'INGRESO' | 'EGRESO';
    totalMontoBs: number;
    cantidadMovimientos: number;
    glosaEjemplo: string;
    motivoEjemplo: string;
    esAnomalo: boolean;
    movimientos: {
      id: string;
      fechaTexto: string;
      hora: string;
      tipo: 'INGRESO' | 'EGRESO';
      montoBs: number;
      banco: string;
      contraparteBanco: string;
      glosaDetalle: string;
      motivoAnomalia?: string;
    }[];
  }[];
  contrapartesFrecuentes: {
    contraparteNombre: string;
    banco: string;
    tipo: 'INGRESO' | 'EGRESO';
    cantidadTransacciones: number;
    totalMontoBs: number;
    promedioBs: number;
    categoriaPrincipal: string;
    movimientos: {
      id: string;
      fechaTexto: string;
      hora: string;
      montoBs: number;
      banco: string;
      glosaDetalle: string;
      categoria: string;
      esAnomalo: boolean;
    }[];
  }[];
} {
  const mapaSugerencias: Record<
    string,
    {
      contraparteNombre: string;
      banco: string;
      tipo: 'INGRESO' | 'EGRESO';
      totalMonto: number;
      movs: MovimientoBancario[];
    }
  > = {};

  const mapaFrecuentes: Record<
    string,
    {
      contraparteNombre: string;
      banco: string;
      tipo: 'INGRESO' | 'EGRESO';
      totalMonto: number;
      movs: MovimientoBancario[];
    }
  > = {};

  // 1. Identificar contrapartes con al menos una transacción grande o anómala no clasificada
  const contrapartesConAnomalias = new Set<string>();
  memoriaMovimientos.forEach((m) => {
    const nombreNorm = normalizarNombreContraparte(m.contraparteNombre, m.glosaDetalle);
    if (!nombreNorm) return;
    const yaTieneRegla = memoriaReglas.some((r) => evaluarCoincidenciaRegla(r, m));
    const estaClasificado = m.categoria !== 'TRANSACCION_ANOMALA' && m.categoria !== 'OTRO_SIN_CLASIFICAR';

    if (!yaTieneRegla && !estaClasificado && (m.esAnomalo || m.montoBs >= 2500)) {
      contrapartesConAnomalias.add(`${nombreNorm}_${m.tipo}`);
    }
  });

  // 2. Agrupar la TOTALIDAD de movimientos no clasificados de esas contrapartes
  memoriaMovimientos.forEach((m) => {
    const nombreNorm = normalizarNombreContraparte(m.contraparteNombre, m.glosaDetalle);
    if (!nombreNorm) return;

    // Verificar si ya tiene regla asignada
    const yaTieneRegla = memoriaReglas.some((r) => evaluarCoincidenciaRegla(r, m));
    const estaClasificado = m.categoria !== 'TRANSACCION_ANOMALA' && m.categoria !== 'OTRO_SIN_CLASIFICAR';

    const key = `${nombreNorm}_${m.tipo}`;

    // Si la persona tiene transacciones grandes/anómalas, se agrupa la TOTALIDAD de sus movimientos no clasificados
    if (!yaTieneRegla && !estaClasificado && contrapartesConAnomalias.has(key)) {
      if (!mapaSugerencias[key]) {
        mapaSugerencias[key] = {
          contraparteNombre: nombreNorm,
          banco: m.banco,
          tipo: m.tipo,
          totalMonto: 0,
          movs: [],
        };
      }
      mapaSugerencias[key].totalMonto += m.montoBs;
      mapaSugerencias[key].movs.push(m);
    }

    // Contrapartes frecuentes
    const fKey = `${nombreNorm}_${m.banco}_${m.tipo}`;
    if (!mapaFrecuentes[fKey]) {
      mapaFrecuentes[fKey] = {
        contraparteNombre: nombreNorm,
        banco: m.banco,
        tipo: m.tipo,
        totalMonto: 0,
        movs: [],
      };
    }
    mapaFrecuentes[fKey].totalMonto += m.montoBs;
    mapaFrecuentes[fKey].movs.push(m);
  });

  const sugerenciasGrandesAnomalas = Object.values(mapaSugerencias)
    .map((item) => ({
      contraparteNombre: item.contraparteNombre,
      banco: item.banco,
      contraparteBanco: extraerBancoContraparte(item.movs[0]?.glosaDetalle || item.movs[0]?.descripcionRaw || '', item.movs[0]?.contraparteBanco || '', item.banco),
      tipo: item.tipo,
      totalMontoBs: Math.round(item.totalMonto * 100) / 100,
      cantidadMovimientos: item.movs.length,
      glosaEjemplo: item.movs[0]?.glosaDetalle || item.movs[0]?.descripcionRaw || '',
      motivoEjemplo: item.movs[0]?.motivoAnomalia || 'Monto abultado o atípico',
      esAnomalo: item.movs.some((m) => m.esAnomalo),
      movimientos: item.movs.map((m) => ({
        id: m.id,
        fechaTexto: m.fechaTexto,
        hora: m.hora,
        tipo: m.tipo,
        montoBs: m.montoBs,
        banco: m.banco,
        contraparteBanco: extraerBancoContraparte(m.glosaDetalle || m.descripcionRaw, m.contraparteBanco, m.banco),
        glosaDetalle: m.glosaDetalle || m.descripcionRaw,
        motivoAnomalia: m.motivoAnomalia,
      })),
    }))
    .sort((a, b) => b.totalMontoBs - a.totalMontoBs);

  const contrapartesFrecuentes = Object.values(mapaFrecuentes)
    .filter((item) => item.movs.length >= 1)
    .map((item) => {
      const topCat = item.movs[0]?.categoria || 'OTRO_SIN_CLASIFICAR';
      return {
        contraparteNombre: item.contraparteNombre,
        banco: item.banco,
        contraparteBanco: extraerBancoContraparte(item.movs[0]?.glosaDetalle || item.movs[0]?.descripcionRaw || '', item.movs[0]?.contraparteBanco || '', item.banco),
        tipo: item.tipo,
        cantidadTransacciones: item.movs.length,
        totalMontoBs: Math.round(item.totalMonto * 100) / 100,
        promedioBs: Math.round((item.totalMonto / item.movs.length) * 100) / 100,
        categoriaPrincipal: topCat,
        movimientos: item.movs.map((m) => ({
          id: m.id,
          fechaTexto: m.fechaTexto,
          hora: m.hora,
          tipo: m.tipo,
          montoBs: m.montoBs,
          banco: m.banco,
          contraparteBanco: extraerBancoContraparte(m.glosaDetalle || m.descripcionRaw, m.contraparteBanco, m.banco),
          glosaDetalle: m.glosaDetalle || m.descripcionRaw,
          categoria: m.categoria,
          esAnomalo: m.esAnomalo,
        })),
      };
    })
    .sort((a, b) => b.cantidadTransacciones - a.cantidadTransacciones || b.totalMontoBs - a.totalMontoBs);

  return { sugerenciasGrandesAnomalas, contrapartesFrecuentes };
}
