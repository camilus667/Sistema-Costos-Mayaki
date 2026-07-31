/**
 * Verifica que las tallas activas sean POR COLEGIO y no globales.
 *
 * QUE DEFECTO FIJA. `PUT /api/colegios/:id/tallas-config` recibia el colegio en la
 * ruta y no lo usaba: escribia `talla.activo`, un flag global, sobre filas que tienen
 * `colegio_id` nulo y por lo tanto son COMPARTIDAS. Apagar una talla "en Cambridge"
 * la apagaba tambien en Internacional SM. La URL prometia un alcance que la consulta
 * no tenia.
 *
 * POR QUE ESTE CHEQUEO Y NO UN TEST UNITARIO. La resolucion del juego de tallas pasa
 * por tres capas que tienen que coincidir: la tabla puente, el motor de costeo y la
 * cabecera de la matriz consolidada. Un unitario sobre la funcion pura no habria visto
 * el defecto real que aparecio al medir: la cabecera unia las tallas de TODOS los
 * colegios con configuracion, asi que con el ambito en Internacional SM igual mostraba
 * la talla que solo Cambridge ofrece. Eso solo se ve consultando las tres capas.
 *
 * NO MUTA NADA PERMANENTE: escribe una configuracion, mide, y restaura el estado
 * previo de cada par que toco. Una verificacion que corrompe lo que verifica es peor
 * que no tenerla.
 *
 * Uso, con el servidor levantado:
 *   pnpm tsx src/scripts/verificarTallasPorColegio.ts
 */

// El `export {}` convierte este archivo en MODULO. Sin el, TypeScript lo trata como
// script global y sus `const` colisionan con las de otros scripts del directorio:
// altaInsumoDeColegio.ts ya declara BASE y main.
export {};

const BASE = process.env.BASE_URL || 'http://localhost:3000';

let fallas = 0;
const ok = (cond: boolean, msg: string, detalle = '') => {
  console.log(`  ${cond ? 'PASA ' : 'FALLA'}  ${msg}${detalle ? '  ::  ' + detalle : ''}`);
  if (!cond) fallas++;
};

const get = async (ruta: string) => {
  const r = await fetch(BASE + ruta);
  if (!r.ok) throw new Error(`${ruta} devolvio ${r.status}`);
  return r.json() as any;
};

const put = async (ruta: string, body: any) => {
  const r = await fetch(BASE + ruta, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as any };
};

const tallasDeMatriz = async (colegioId: string): Promise<string[]> => {
  const d = await get(`/api/calculo/matriz-consolidada?colegioId=${colegioId}`);
  return (d.tallas || []).map((t: any) => String(t.codigo));
};

const tallasDeMotor = async (colegioId: string): Promise<string[]> => {
  const res = await get(`/api/dashboard-resumen?colegioId=${colegioId}`);
  const prenda = (res.prendas || [])[0];
  if (!prenda) return [];
  const m = await get(`/api/calculo/matriz-prenda/${prenda.id}?colegioId=${colegioId}`);
  return (m.data || []).map((t: any) => String(t.tallaCodigo));
};

async function main() {
  const { data: colegios } = await get('/api/colegios');
  if (!colegios || colegios.length < 2) {
    console.log('Se necesitan al menos DOS colegios para poder medir el aislamiento.');
    console.log('Con un solo colegio este chequeo pasaria en verde sin haber probado nada,');
    console.log('que es exactamente el verde vacuo que este repo ya conoce.');
    process.exit(0);
  }

  const A = colegios[0];
  const B = colegios[1];
  console.log(`\nColegio A: ${A.nombre}\nColegio B: ${B.nombre}\n`);

  // Se elige una talla que los DOS ofrezcan hoy: si no, apagarla en A no probaria nada.
  const cfgA = await get(`/api/colegios/${A.id}/config`);
  const cfgB = await get(`/api/colegios/${B.id}/config`);
  const activasB = new Set(cfgB.tallas.filter((t: any) => t.activo).map((t: any) => String(t.id)));
  const candidata = cfgA.tallas.find((t: any) => t.activo && activasB.has(String(t.id)));

  if (!candidata) {
    console.log('No hay ninguna talla activa en los dos colegios: no se puede medir.');
    process.exit(0);
  }
  console.log(`Talla de prueba: ${candidata.codigo}\n`);

  const previoA = candidata.activo;

  const matrizA0 = await tallasDeMatriz(A.id);
  const matrizB0 = await tallasDeMatriz(B.id);
  const motorB0 = await tallasDeMotor(B.id);
  ok(matrizA0.includes(candidata.codigo), `la talla ${candidata.codigo} esta en ${A.nombre} antes`);
  ok(matrizB0.includes(candidata.codigo), `la talla ${candidata.codigo} esta en ${B.nombre} antes`);

  // ---- se apaga SOLO en A ----
  const r = await put(`/api/colegios/${A.id}/tallas-config`, {
    tallas: [{ id: candidata.id, activo: false }],
  });
  ok(r.status === 200, 'el PUT responde 200');
  ok(r.json.tallasConfiguradas === 1,
     'el PUT reporta CUANTAS filas escribio, no solo exito',
     `escritas=${r.json.tallasConfiguradas}`);

  try {
    const matrizA1 = await tallasDeMatriz(A.id);
    const matrizB1 = await tallasDeMatriz(B.id);
    const motorB1 = await tallasDeMotor(B.id);
    const cfgA1 = await get(`/api/colegios/${A.id}/config`);
    const cfgB1 = await get(`/api/colegios/${B.id}/config`);
    const enA = cfgA1.tallas.find((t: any) => String(t.id) === String(candidata.id));
    const enB = cfgB1.tallas.find((t: any) => String(t.id) === String(candidata.id));

    // EL CHEQUEO CENTRAL, y es el que fallaba antes de la tabla puente.
    ok(!matrizA1.includes(candidata.codigo),
       `apagada en ${A.nombre}: DESAPARECE de su matriz`);
    ok(matrizB1.includes(candidata.codigo),
       `y SIGUE en ${B.nombre}: apagar en un colegio no apaga en el otro`,
       `${B.nombre} ve ${matrizB1.length} tallas`);
    ok(motorB1.length === motorB0.length,
       `el MOTOR de ${B.nombre} sigue costeando las mismas tallas`,
       `${motorB0.length} -> ${motorB1.length}`);
    ok(enA && enA.activo === false, `la pantalla de ${A.nombre} la muestra apagada`);
    ok(enB && enB.activo === true, `la pantalla de ${B.nombre} la muestra activa`);
    ok(enA && enA.activoGlobal === true,
       'el flag GLOBAL de la talla no se toco: la talla sigue existiendo para el sistema');

    // Guarda contra colegio inexistente: una fila con colegio fantasma apagaria
    // tallas de nadie y seria invisible para toda pantalla que filtre.
    const huerfano = await put('/api/colegios/no-existe-este-id/tallas-config', {
      tallas: [{ id: candidata.id, activo: false }],
    });
    ok(huerfano.status === 404, 'un colegio inexistente se rechaza con 404');
  } finally {
    // ---- restaurar ----
    await put(`/api/colegios/${A.id}/tallas-config`, {
      tallas: [{ id: candidata.id, activo: previoA }],
    });
    const matrizA2 = await tallasDeMatriz(A.id);
    ok(matrizA2.includes(candidata.codigo) === !!previoA,
       'el estado previo quedo restaurado: la verificacion no deja rastro');
  }

  console.log(`\n  ${fallas === 0 ? 'TALLAS POR COLEGIO: aislamiento verificado.' : fallas + ' CHEQUEO(S) FALLAN'}\n`);
  process.exit(fallas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
