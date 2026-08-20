import XLSX from 'xlsx';
import { BancoTipo, CategoriaTransaccion, MovimientoBancario, BankImportResult } from '../types';

function parseMontoLatino(val: any): number {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return val;

  let str = String(val).trim();
  str = str.replace(/\s+/g, '');

  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(str)) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d+(,\d+)?$/.test(str)) {
    str = str.replace(',', '.');
  } else if (/^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(str)) {
    str = str.replace(/,/g, '');
  }

  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function parseFechaIsoUniversal(fechaStr: string): { iso: string; fmt: string; anio: number; mes: number; trimestre: string } {
  const str = String(fechaStr || '').trim();
  let y = 2026;
  let m = 1;
  let d = 1;

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const parts = str.split('/');
    d = parseInt(parts[0], 10);
    m = parseInt(parts[1], 10);
    y = parseInt(parts[2], 10);
  } else if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(str)) {
    const parts = str.split('/');
    d = parseInt(parts[0], 10);
    m = parseInt(parts[1], 10);
    const shortY = parseInt(parts[2], 10);
    y = shortY < 50 ? 2000 + shortY : 1900 + shortY;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const parts = str.split('-');
    y = parseInt(parts[0], 10);
    m = parseInt(parts[1], 10);
    d = parseInt(parts[2], 10);
  } else {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      y = parsed.getFullYear();
      m = parsed.getMonth() + 1;
      d = parsed.getDate();
    }
  }

  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const fmt = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  const trimestre = `Q${Math.ceil(m / 3)}`;

  return { iso, fmt, anio: y, mes: m, trimestre };
}

export function clasificarTransaccion(
  montoBs: number,
  tipo: 'INGRESO' | 'EGRESO',
  contraparteNombre: string,
  glosaDetalle: string,
  descripcionRaw: string
): { categoria: CategoriaTransaccion; esAnomalo: boolean; motivoAnomalia?: string } {
  const textFull = `${contraparteNombre} ${glosaDetalle} ${descripcionRaw}`.toUpperCase();

  if (
    textFull.includes('CHARITO') ||
    textFull.includes('KODITEX') ||
    textFull.includes('JADUE') ||
    textFull.includes('TELA') ||
    textFull.includes('TELAS') ||
    textFull.includes('TEXTIL') ||
    textFull.includes('MERCERIA') ||
    textFull.includes('BOTONES') ||
    textFull.includes('HILOS')
  ) {
    return { categoria: 'COMPRA_TELAS_INSUMOS', esAnomalo: false };
  }

  if (
    textFull.includes('PANTALON') ||
    textFull.includes('PANTALONES') ||
    textFull.includes('POLERA') ||
    textFull.includes('CAMISA') ||
    textFull.includes('CHAMARRA') ||
    textFull.includes('CASACA') ||
    textFull.includes('UNIFORME') ||
    textFull.includes('COLEGIO') ||
    textFull.includes('VENTA') ||
    textFull.includes('VENTAS')
  ) {
    if (tipo === 'INGRESO' && montoBs >= 4500) {
      return {
        categoria: 'TRANSACCION_ANOMALA',
        esAnomalo: true,
        motivoAnomalia: `Depósito individual abultado de Bs. ${montoBs.toLocaleString('es-BO')} (Supera el rango habitual de venta minorista).`,
      };
    }
    return { categoria: 'VENTA_UNIFORMES_CLIENTE', esAnomalo: false };
  }

  if (
    textFull.includes('HIPERMAXI') ||
    textFull.includes('FARMACORP') ||
    textFull.includes('GENEX') ||
    textFull.includes('POS:') ||
    textFull.includes('LINKSER') ||
    textFull.includes('BIOPETROL') ||
    textFull.includes('CINE')
  ) {
    return { categoria: 'SERVICIOS_COMERCIO_POS', esAnomalo: false };
  }

  if (textFull.includes('ATM') || textFull.includes('RETIRO') || textFull.includes('EFECTIVO')) {
    if (montoBs >= 3000) {
      return {
        categoria: 'RETIRO_ATM_CAJA',
        esAnomalo: true,
        motivoAnomalia: `Retiro de efectivo alto en ATM por Bs. ${montoBs.toLocaleString('es-BO')}.`,
      };
    }
    return { categoria: 'RETIRO_ATM_CAJA', esAnomalo: false };
  }

  if (textFull.includes('CAPITALIZACION') || textFull.includes('RCIVA') || textFull.includes('COMISION') || textFull.includes('IMPUESTO')) {
    return { categoria: 'CARGO_BANCARIO_IMPUESTO', esAnomalo: false };
  }

  if (tipo === 'INGRESO' && montoBs >= 3000) {
    return {
      categoria: 'TRANSACCION_ANOMALA',
      esAnomalo: true,
      motivoAnomalia: `Ingreso atípico elevado de Bs. ${montoBs.toLocaleString('es-BO')} sin concepto explícito de uniformes.`,
    };
  }

  if (tipo === 'EGRESO' && montoBs >= 4000) {
    return {
      categoria: 'TRANSACCION_ANOMALA',
      esAnomalo: true,
      motivoAnomalia: `Egreso atípico elevado de Bs. ${montoBs.toLocaleString('es-BO')}.`,
    };
  }

  const catDef: CategoriaTransaccion = tipo === 'INGRESO' ? 'VENTA_UNIFORMES_CLIENTE' : 'OTRO_SIN_CLASIFICAR';
  return { categoria: catDef, esAnomalo: false };
}

// ----------------------------------------------------------------------
// PARSER DEDICADO 1: BANCO NACIONAL DE BOLIVIA (BNB)
// ----------------------------------------------------------------------
function parsearBNB(rows: any[][], fileName: string): BankImportResult {
  let nroCuenta = '';
  let titularNombre = '';

  // Buscar metadatos en cabecera
  rows.slice(0, 10).forEach((r) => {
    const line = (r || []).join(' ');
    const matchCuenta = line.match(/(?:Cuenta|Cta\.?)\s*:?\s*(\d{8,16})/i);
    if (matchCuenta) nroCuenta = matchCuenta[1];
    const matchTitular = line.match(/(?:Titular|Nombre)\s*:?\s*([A-Z\s]{4,40})/i);
    if (matchTitular) titularNombre = matchTitular[1].trim();
  });

  if (!nroCuenta) nroCuenta = '2500528063';
  if (!titularNombre || titularNombre === 'MODA MAYAKI') titularNombre = 'Angel Limachi';

  const movimientos: MovimientoBancario[] = [];

  // Mapeo dinámico de columnas desde la Fila 2 de Excel (índice 1 en JS)
  let colFecha = 0;
  let colHora = 1;
  let colDesc = 3;
  let colRef = 4;
  let colDebito = 7;
  let colCredito = 8;
  let colSaldo = 9;
  let colGlosa = 10;

  if (rows[1] && Array.isArray(rows[1])) {
    rows[1].forEach((val, cIdx) => {
      const vUpper = String(val || '').toUpperCase().trim();
      if (vUpper === 'FECHA') colFecha = cIdx;
      if (vUpper === 'HORA') colHora = cIdx;
      if (vUpper === 'DESCRIPCIÓN' || vUpper === 'DESCRIPCION') colDesc = cIdx;
      if (vUpper === 'REFERENCIA') colRef = cIdx;
      if (vUpper === 'DÉBITOS' || vUpper === 'DEBITOS' || vUpper === 'DÉBITO' || vUpper === 'DEBITO') colDebito = cIdx;
      if (vUpper === 'CRÉDITOS' || vUpper === 'CREDITOS' || vUpper === 'CRÉDITO' || vUpper === 'CREDITO') colCredito = cIdx;
      if (vUpper === 'SALDO') colSaldo = cIdx;
      if (vUpper.includes('ADICIONAL') || vUpper.includes('GLOSA')) colGlosa = cIdx;
    });
  }

  // Los datos de transacciones del BNB empiezan a partir de la Fila 3 (índice 2 en JS)
  const dataRows = rows.slice(2);

  dataRows.forEach((r, idx) => {
    if (!r || r.length < 4) return;
    const fechaRaw = r[colFecha];
    if (!fechaRaw || !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(String(fechaRaw).trim())) return;

    const hora = String(r[colHora] || '00:00:00').trim();
    const descripcionRaw = String(r[colDesc] || '').trim();
    const referencia = String(r[colRef] || '').trim();
    const creditoVal = parseMontoLatino(r[colCredito]);
    const debitoVal = parseMontoLatino(r[colDebito]);
    const saldoVal = parseMontoLatino(r[colSaldo]);
    const glosaRaw = String(r[colGlosa] || r[colRef] || '').trim();

    const tipo: 'INGRESO' | 'EGRESO' = creditoVal !== 0 ? 'INGRESO' : 'EGRESO';
    const rawMonto = tipo === 'INGRESO' ? creditoVal : debitoVal;

    if (rawMonto === 0) return;

    let contraparteNombre = '';
    let contraparteCuenta = '';
    let contraparteBanco = '';
    let glosaDetalle = '';

    const matchOrig = glosaRaw.match(/(?:Nombre Originante|Nombre|Nombre:)\s*:?\s*([^.;]+)/i);
    if (matchOrig) contraparteNombre = matchOrig[1].trim();

    const matchCta = glosaRaw.match(/(?:Cuenta Origen|Cuenta Destino|Cuenta)\s*:?\s*(\d+)/i);
    if (matchCta) contraparteCuenta = matchCta[1].trim();

    const matchBco = glosaRaw.match(/(?:Banco)\s*:?\s*([^.;]+)/i);
    if (matchBco) contraparteBanco = matchBco[1].trim();

    const matchAdic = glosaRaw.match(/(?:Dato Adicional|Glosa)\s*:?\s*([^.;]+)/i);
    if (matchAdic) glosaDetalle = matchAdic[1].trim();

    if (!contraparteNombre && referencia && !referencia.startsWith('2P')) {
      contraparteNombre = referencia;
    }
    if (!contraparteNombre) contraparteNombre = 'Cliente General / Transferencia BNB';
    if (!glosaDetalle) glosaDetalle = glosaRaw;

    const fechaObj = parseFechaIsoUniversal(String(fechaRaw));
    const esReversion = rawMonto < 0;
    const montoBsAbs = Math.abs(rawMonto);
    const clasif = clasificarTransaccion(montoBsAbs, tipo, contraparteNombre, glosaDetalle, descripcionRaw);

    movimientos.push({
      id: `bnb_${fechaObj.iso}_${idx}`,
      banco: 'BNB',
      nroCuentaTitular: nroCuenta,
      titularNombre,
      fechaIso: fechaObj.iso,
      fechaTexto: fechaObj.fmt,
      hora,
      anio: fechaObj.anio,
      mes: fechaObj.mes,
      trimestre: fechaObj.trimestre,
      tipo,
      montoBs: montoBsAbs,
      saldoBs: saldoVal,
      descripcionRaw,
      referencia,
      contraparteNombre,
      contraparteCuenta,
      contraparteBanco,
      glosaDetalle,
      categoria: clasif.categoria,
      esAnomalo: clasif.esAnomalo,
      motivoAnomalia: clasif.motivoAnomalia,
      esReversion,
      ordenOriginal: idx,
      archivoOrigen: fileName,
      creadoEn: new Date().toISOString(),
    });
  });

  return calcularResumenExtracto('BNB', nroCuenta, titularNombre, movimientos, rows);
}

// ----------------------------------------------------------------------
// PARSER DEDICADO 2: BANCO BISA
// ----------------------------------------------------------------------
function parsearBancoBisa(rows: any[][], fileName: string): BankImportResult {
  let nroCuenta = '';
  let titularNombre = '';

  rows.slice(0, 12).forEach((r) => {
    const line = (r || []).join(' ');
    const matchCuenta = line.match(/(?:Numero de Cuenta:|Cuenta:)\s*(\d{6,16})/i);
    if (matchCuenta) nroCuenta = matchCuenta[1];
    const matchTitular = line.match(/(?:Nombre de Cuenta:|Nombre:)\s*([A-Z\s]{4,40})/i);
    if (matchTitular && !titularNombre) titularNombre = matchTitular[1].trim();
  });

  if (!nroCuenta) nroCuenta = '0070510014';
  if (!titularNombre || titularNombre === 'MODA MAYAKI') titularNombre = 'MODA MAYAKI';

  const movimientos: MovimientoBancario[] = [];

  rows.forEach((r, idx) => {
    if (!r || r.length < 5) return;
    const fechaRaw = r[1];
    if (!fechaRaw || !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(String(fechaRaw).trim())) return;

    const hora = String(r[2] || '00:00').trim();
    const descripcionRaw = String(r[4] || '').trim();
    const importeVal = parseMontoLatino(r[5]);
    const saldoVal = parseMontoLatino(r[6]);
    const infoComp = String(r[7] || '').trim();

    const tipo = importeVal >= 0 ? 'INGRESO' : 'EGRESO';
    const montoBs = Math.abs(importeVal);

    if (montoBs <= 0) return;

    let contraparteNombre = '';
    let contraparteCuenta = '';
    let contraparteBanco = '';
    let glosaDetalle = '';

    if (infoComp.includes(',')) {
      const partes = infoComp.split(',').map((p) => p.trim());
      if (partes[1]) contraparteBanco = partes[1];
      if (partes[2]) contraparteCuenta = partes[2];
      if (partes[3]) contraparteNombre = partes[3];
      if (partes[4]) glosaDetalle = partes[4];
    }

    if (!contraparteNombre) contraparteNombre = 'Cliente General QR / e-BISA';
    if (!glosaDetalle) glosaDetalle = infoComp || descripcionRaw;

    const fechaObj = parseFechaIsoUniversal(String(fechaRaw));
    const clasif = clasificarTransaccion(montoBs, tipo, contraparteNombre, glosaDetalle, descripcionRaw);

    movimientos.push({
      id: `bisa_${fechaObj.iso}_${idx}`,
      banco: 'Banco Bisa',
      nroCuentaTitular: nroCuenta,
      titularNombre,
      fechaIso: fechaObj.iso,
      fechaTexto: fechaObj.fmt,
      hora,
      anio: fechaObj.anio,
      mes: fechaObj.mes,
      trimestre: fechaObj.trimestre,
      tipo,
      montoBs,
      saldoBs: saldoVal,
      descripcionRaw,
      referencia: String(r[10] || ''),
      contraparteNombre,
      contraparteCuenta,
      contraparteBanco,
      glosaDetalle,
      categoria: clasif.categoria,
      esAnomalo: clasif.esAnomalo,
      motivoAnomalia: clasif.motivoAnomalia,
      ordenOriginal: idx,
      archivoOrigen: fileName,
      creadoEn: new Date().toISOString(),
    });
  });

  return calcularResumenExtracto('Banco Bisa', nroCuenta, titularNombre, movimientos, rows);
}

// ----------------------------------------------------------------------
// PARSER DEDICADO 3: BANCO UNIÓN
// ----------------------------------------------------------------------
function parsearBancoUnion(rows: any[][], fileName: string): BankImportResult {
  let nroCuenta = '';
  let titularNombre = '';

  rows.slice(0, 15).forEach((r) => {
    const line = (r || []).join(' ');
    const matchCuenta = line.match(/(?:Cuenta:)\s*(\d{8,16})/i);
    if (matchCuenta) nroCuenta = matchCuenta[1];
    if (r[1] && typeof r[1] === 'string' && r[1].length > 4 && !titularNombre && !r[1].includes(':')) {
      titularNombre = r[1].trim();
    }
  });

  if (!nroCuenta) nroCuenta = '10000021846049';
  if (!titularNombre) titularNombre = 'VEIMAR LIMACHI MORON';

  // Buscar índices dinámicos de columnas
  let colFecha = 1;
  let colDesc = 7;
  let colDoc = 20;
  let colMonto = 25;
  let colSaldo = 29;

  rows.forEach((r) => {
    (r || []).forEach((val, cIdx) => {
      const vUpper = String(val || '').toUpperCase();
      if (vUpper.includes('FECHA MOVIMIENTO')) colFecha = cIdx;
      if (vUpper.includes('DESCRIPCIÓN')) colDesc = cIdx;
      if (vUpper.includes('DOCUMENTO')) colDoc = cIdx;
      if (vUpper.includes('MONTO')) colMonto = cIdx;
      if (vUpper.includes('SALDO')) colSaldo = cIdx;
    });
  });

  const movimientos: MovimientoBancario[] = [];

  rows.forEach((r, idx) => {
    if (!r || r.length < 4) return;
    const fechaRaw = r[colFecha];
    if (!fechaRaw || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(fechaRaw).trim())) return;

    const descripcionRaw = String(r[colDesc] || r[3] || '').trim();
    const nroDoc = String(r[colDoc] || r[10] || '').trim();
    const montoRaw = r[colMonto] || r[8] || '0';
    const saldoRaw = r[colSaldo] || r[9] || '0';

    const montoParsed = parseMontoLatino(montoRaw);
    const saldoVal = parseMontoLatino(saldoRaw);

    const tipo = montoParsed >= 0 ? 'INGRESO' : 'EGRESO';
    const montoBs = Math.abs(montoParsed);

    if (montoBs <= 0) return;

    const contraparteNombre = descripcionRaw.startsWith('POS:')
      ? descripcionRaw.replace('POS:', '').trim()
      : (descripcionRaw.startsWith('ATM:') ? 'Cajero Automático / ATM' : 'Operación Banco Unión');
    const glosaDetalle = descripcionRaw;

    const fechaObj = parseFechaIsoUniversal(String(fechaRaw));
    const clasif = clasificarTransaccion(montoBs, tipo, contraparteNombre, glosaDetalle, descripcionRaw);

    movimientos.push({
      id: `bunion_${fechaObj.iso}_${idx}`,
      banco: 'Banco Unión',
      nroCuentaTitular: nroCuenta,
      titularNombre,
      fechaIso: fechaObj.iso,
      fechaTexto: fechaObj.fmt,
      hora: '00:00:00',
      anio: fechaObj.anio,
      mes: fechaObj.mes,
      trimestre: fechaObj.trimestre,
      tipo,
      montoBs,
      saldoBs: saldoVal,
      descripcionRaw,
      referencia: nroDoc,
      contraparteNombre,
      contraparteCuenta: '',
      contraparteBanco: 'BANCO UNION',
      glosaDetalle,
      categoria: clasif.categoria,
      esAnomalo: clasif.esAnomalo,
      motivoAnomalia: clasif.motivoAnomalia,
      ordenOriginal: idx,
      archivoOrigen: fileName,
      creadoEn: new Date().toISOString(),
    });
  });

  return calcularResumenExtracto('Banco Unión', nroCuenta, titularNombre, movimientos, rows);
}

// ----------------------------------------------------------------------
// CÁLCULO DE SALDOS CONCILIADOS
// ----------------------------------------------------------------------
function calcularResumenExtracto(
  banco: BancoTipo,
  nroCuenta: string,
  titularNombre: string,
  movimientos: MovimientoBancario[],
  rows: any[][]
): BankImportResult {
  let totalIngresosBs = 0;
  let totalEgresosBs = 0;
  let totalAnomalias = 0;

  movimientos.forEach((m) => {
    const val = m.esReversion ? -m.montoBs : m.montoBs;
    if (m.tipo === 'INGRESO') totalIngresosBs += val;
    else totalEgresosBs += val;
    if (m.esAnomalo) totalAnomalias++;
  });

  let saldoInicialHeader = 0;
  rows.slice(0, 15).forEach((r) => {
    const line = (r || []).join(' ');
    const match = line.match(/Saldo\s*Inicial\s*:?\s*([0-9.,]+)/i);
    if (match) {
      saldoInicialHeader = parseMontoLatino(match[1]);
    }
  });

  let saldoInicialBs = 0;
  let saldoFinalBs = 0;

  if (movimientos.length > 0) {
    // Si el archivo original está en orden ascendente (ej. Banco Unión donde los primeros índices son más antiguos),
    // determinamos si el archivo viene en orden ascendente o descendente.
    const isFileAscending =
      movimientos.length > 1 &&
      movimientos[0].fechaIso.localeCompare(movimientos[movimientos.length - 1].fechaIso) < 0;

    const movsAsc = [...movimientos].sort((a, b) => {
      const cmpDate = a.fechaIso.localeCompare(b.fechaIso);
      if (cmpDate !== 0) return cmpDate;
      const cmpTime = a.hora.localeCompare(b.hora);
      if (cmpTime !== 0) return cmpTime;
      // Para empates en misma fecha y hora: mantener orden cronológico real del archivo
      return isFileAscending
        ? (a.ordenOriginal || 0) - (b.ordenOriginal || 0)
        : (b.ordenOriginal || 0) - (a.ordenOriginal || 0);
    });

    const movOldest = movsAsc[0];
    const movNewest = movsAsc[movsAsc.length - 1];

    if (saldoInicialHeader > 0) {
      saldoInicialBs = saldoInicialHeader;
    } else {
      const oldestVal = movOldest.esReversion ? -movOldest.montoBs : movOldest.montoBs;
      saldoInicialBs = movOldest.tipo === 'INGRESO' ? movOldest.saldoBs - oldestVal : movOldest.saldoBs + oldestVal;
    }
    saldoFinalBs = movNewest.saldoBs;
  }

  saldoInicialBs = Math.round(saldoInicialBs * 100) / 100;
  saldoFinalBs = Math.round(saldoFinalBs * 100) / 100;
  totalIngresosBs = Math.round(totalIngresosBs * 100) / 100;
  totalEgresosBs = Math.round(totalEgresosBs * 100) / 100;

  const balanceCalculado = Math.round((saldoInicialBs + totalIngresosBs - totalEgresosBs) * 100) / 100;
  const conciliadoOk = Math.abs(balanceCalculado - saldoFinalBs) < 1.0;

  return {
    bancoDetectado: banco,
    nroCuenta,
    titularNombre,
    totalTransacciones: movimientos.length,
    saldoInicialBs,
    totalIngresosBs,
    totalEgresosBs,
    saldoFinalBs,
    conciliadoOk,
    totalAnomalias,
    movimientos,
  };
}

// ----------------------------------------------------------------------
// ENRUTADOR PRINCIPAL EVALUANDO POR NOMBRE DE BANCO EN EL NOMBRE DE ARCHIVO
// ----------------------------------------------------------------------
export function parsearExtractoBancarioBuffer(fileBuffer: Buffer, fileName: string): BankImportResult {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer', raw: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });

  const nameUpper = fileName.toUpperCase();

  // 1. Evaluar por nombre exacto de banco en el nombre del archivo Excel
  if (nameUpper.includes('BNB')) {
    console.log(`🏦 Procesando extracto BNB con parser dedicado para '${fileName}'`);
    return parsearBNB(rows, fileName);
  }

  if (nameUpper.includes('BISA')) {
    console.log(`🏦 Procesando extracto Banco Bisa con parser dedicado para '${fileName}'`);
    return parsearBancoBisa(rows, fileName);
  }

  if (nameUpper.includes('UNION') || nameUpper.includes('BUNION')) {
    console.log(`🏦 Procesando extracto Banco Unión con parser dedicado para '${fileName}'`);
    return parsearBancoUnion(rows, fileName);
  }

  // 2. Fallback: Evaluar por contenido del documento si el nombre de archivo no lo contiene
  const textSample = rows.slice(0, 15).map((r) => (r || []).join(' ')).join(' ').toUpperCase();
  if (textSample.includes('BANCO NACIONAL DE BOLIVIA') || textSample.includes('DEBITO CTA POR ACH')) {
    return parsearBNB(rows, fileName);
  }
  if (textSample.includes('BANCO BISA') || textSample.includes('E-BISA')) {
    return parsearBancoBisa(rows, fileName);
  }

  return parsearBancoUnion(rows, fileName);
}
