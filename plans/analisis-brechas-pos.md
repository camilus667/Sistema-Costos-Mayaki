# Análisis de Brechas: SISTEMA INVENTARIO vs. un POS completo

> Objetivo: saber exactamente **qué ya está construido** y **qué falta** para tener un sistema
> propio que cubra lo que hoy se usa del POS externo. Esto define el plan de construcción.
>
> Nota de alcance: este relevamiento se hace sobre el código propio del proyecto y sobre la
> descripción funcional que el usuario aporte de las pantallas que usa a diario. No se clona
> código de terceros.

---

## 1. Lo que YA está construido (Back-office — muy sólido)

El proyecto actual es un sistema de **gestión de costos e inventario de uniformes escolares**
con tres paquetes. Esto es la parte "administrativa" y está bastante avanzada.

### 1.1 [`packages/api`](packages/api/src/server.ts) — Backend (Hono + Drizzle + SQLite)

| Módulo | Estado | Evidencia |
|--------|--------|-----------|
| Multi-colegio | ✅ | [`colegios`](packages/api/src/database/schema.ts:7) con abreviatura, orden |
| Usuarios y roles | ✅ | [`usuarios`](packages/api/src/database/schema.ts:51) + [`usuarioColegios`](packages/api/src/database/schema.ts:64) (super_admin/admin/editor/visualizador) |
| Catálogo de productos (prendas) | ✅ | [`productos`](packages/api/src/database/schema.ts:110) con modo costeo confeccion/adquirido |
| Tallas por colegio | ✅ | [`tallas`](packages/api/src/database/schema.ts:157) + [`colegioTallas`](packages/api/src/database/schema.ts:195) |
| Telas / materia prima | ✅ | [`telas`](packages/api/src/database/schema.ts:219) con rendimiento, densidad, precio |
| Accesorios / insumos | ✅ | [`accesorios`](packages/api/src/database/schema.ts:239) + [`detalleAccesorio`](packages/api/src/database/schema.ts:275) |
| Mano de obra por tipo de prenda | ✅ | [`manoObraTipo`](packages/api/src/database/schema.ts:302) |
| Costos indirectos | ✅ | [`costosIndirectos`](packages/api/src/database/schema.ts:330) |
| Precios de adquisición (comprados) | ✅ | [`preciosAdquisicion`](packages/api/src/database/schema.ts:359) con vigencia temporal |
| Precios de venta con vigencia | ✅ | [`preciosVenta`](packages/api/src/database/schema.ts:377) + [`historicoPrecios`](packages/api/src/database/schema.ts:436) |
| Inventario sintético + transaccional | ✅ | [`inventario`](packages/api/src/database/schema.ts:406) + [`inventarioTransacciones`](packages/api/src/database/schema.ts:419) (entrada/salida/merma/ajuste) |
| Motor de costeo | ✅ | [`costeoInputs.service.ts`](packages/api/src/services/calculo/costeoInputs.service.ts) replica CAMBRIDGE.xlsx |
| Modalidad fiscal / IVA | ✅ | [`modalidadFiscal.ts`](packages/api/src/services/modalidadFiscal.ts) |
| Auditoría | ✅ | [`auditoria`](packages/api/src/database/schema.ts:459) |
| Snapshots de costos | ✅ | [`costoSnapshots`](packages/api/src/database/schema.ts:474) |
| Integración con productos del POS | ✅ | [`posProductos`](packages/api/src/database/schema.ts:498) |
| Ventas importadas del POS | ✅ | [`posVentas`](packages/api/src/database/schema.ts:539) |
| Proyecciones de venta | ✅ | [`proyeccionReglas`](packages/api/src/database/schema.ts:571) + [`proyeccionesGuardadas`](packages/api/src/database/schema.ts:584) |

### 1.2 [`packages/pos-manager`](packages/pos-manager/src/routes/pos.ts) — Matrices POS

- Importar archivo del POS → [`importarArchivoPos`](packages/pos-manager/src/services/posImport.service.ts)
- Grupos y matrices por colegio → [`obtenerMatrizGrupo`](packages/pos-manager/src/services/posMatrix.service.ts)
- Exportar Excel (por colegio, global, formato POS-38) → [`posExport.service.ts`](packages/pos-manager/src/services/posExport.service.ts)
- Snapshots POS → [`posSnapshots.service.ts`](packages/pos-manager/src/services/posSnapshots.service.ts)

### 1.3 [`packages/sales-manager`](packages/sales-manager/src/routes/sales.ts) — Analítica de ventas

- Importar ventas del POS → [`importarVentasPos`](packages/sales-manager/src/services/salesImport.service.ts)
- Resumen por colegio / periodo / prenda y talla → [`salesAnalytics.service.ts`](packages/sales-manager/src/services/salesAnalytics.service.ts)
- Proyecciones → [`salesProjection.service.ts`](packages/sales-manager/src/services/salesProjection.service.ts)
- Simulador → [`salesSimulator.service.ts`](packages/sales-manager/src/services/salesSimulator.service.ts)
- Liquidación de talleristas → [`talleristas.service.ts`](packages/sales-manager/src/services/talleristas.service.ts)
- Vistas imprimibles PDF

---

## 2. Lo que FALTA (Front-office POS — el punto de venta real)

La brecha principal: el sistema actual es **back-office**. Las ventas **se importan por archivo**
desde el POS externo; no hay una pantalla de caja que las registre en tiempo real. Para replicar
un POS completo hay que construir el **front-office**.

| Módulo faltante | Qué hace un POS típico | Prioridad |
|-----------------|------------------------|-----------|
| **Pantalla de venta (caja)** | Interfaz del cajero: buscar producto, agregar al carrito, cobrar | 🔴 Alta |
| **Carrito / ticket en curso** | Líneas de venta, cantidades, edición, descuento por línea | 🔴 Alta |
| **Cobro y medios de pago** | Efectivo, tarjeta, QR, transferencia; vuelto; pago parcial | 🔴 Alta |
| **Descuento de stock en tiempo real** | Al confirmar venta, genera `salida` en [`inventarioTransacciones`](packages/api/src/database/schema.ts:419) | 🔴 Alta |
| **Comprobante / recibo** | Generar e imprimir ticket/factura con los datos de la venta | 🟠 Media |
| **Apertura y cierre de caja** | Turnos, fondo inicial, arqueo, reporte de cierre | 🟠 Media |
| **Devoluciones / anulaciones** | Reversa de venta y reposición de stock | 🟠 Media |
| **Clientes** | Fichas de cliente, historial de compras, crédito | 🟡 Baja |
| **Descuentos y promociones** | % global, cupones, precios por volumen | 🟡 Baja |
| **Lector de código de barras** | Búsqueda por código (ya existe [`codigoPos.ts`](packages/api/src/services/codigoPos.ts)) | 🟡 Baja |
| **Dashboard de ventas del día** | Ventas en vivo, top productos, comparativa | 🟡 Baja |
| **Multi-sucursal en vivo** | Sincronización de stock entre sucursales | 🟡 Baja |

---

## 3. Lectura estratégica

**Fortaleza:** el motor de costeo, la valorización de inventario y la analítica de ventas ya
están resueltos y probados. Eso es lo más difícil de un sistema de este tipo.

**Brecha concreta:** falta la **pantalla de venta (front-office)** que registre operaciones en
tiempo real y descuente stock, en lugar de importar un archivo al final del día.

**Ventaja:** el esquema de datos ya soporta todo lo necesario. [`posVentas`](packages/api/src/database/schema.ts:539)
ya modela una venta completa (pedido, estado, fecha, producto, talla, cantidad, precio, subtotal,
medio de pago, usuario, sucursal). Construir la pantalla de caja es, en gran parte, **escribir en
esa tabla desde una UI** en lugar de desde un importador.

---

## 4. Próximo paso propuesto

Construir el **módulo de Punto de Venta (front-office)** como un nuevo paquete
`packages/pos-frontend` (o una pantalla dentro de `pos-manager`) que:

1. Reuse el catálogo existente ([`posProductos`](packages/api/src/database/schema.ts:498)) para mostrar los productos.
2. Permita armar un carrito y cobrar (medios de pago).
3. Al confirmar, inserte en [`posVentas`](packages/api/src/database/schema.ts:539) y genere la
   `salida` correspondiente en [`inventarioTransacciones`](packages/api/src/database/schema.ts:419).
4. Emita un comprobante imprimible.

Para dimensionar cada pantalla con exactitud (qué botones hay, qué hace cada uno, cómo se
relacionan), se necesita que el usuario **describa o envíe capturas de las pantallas que usa a
diario** en su POS actual. Como usuario legítimo, describir lo que ve en su pantalla es el insumo
correcto para diseñar la funcionalidad equivalente con código propio.
