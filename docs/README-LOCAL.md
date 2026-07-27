# Guía de Desarrollo Local - Sistema de Uniformes

## Configuración del Entorno Local

### Iniciar el Servidor Local

```bash
# En la raíz del proyecto
pnpm dev:local
```

Esto inicia el servidor en `http://localhost:3000` usando:
- **sql.js**: Base de datos SQLite en memoria (pure JavaScript)
- **Hono.js**: Framework de routing
- **Drizzle ORM**: Para consultas type-safe

### Endpoints Disponibles

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/colegios` | GET, POST, PUT, DELETE | Gestión de colegios |
| `/api/usuarios` | GET, POST | Gestión de usuarios |
| `/api/productos` | GET, POST | Gestión de productos |
| `/api/tallas` | GET, POST | Gestión de tallas |
| `/api/telas` | GET, POST | Gestión de telas |
| `/api/accesorios` | GET, POST | Gestión de accesorios |
| `/api/calculo/calcular` | POST | Calcular costo de prenda |
| `/api/inventario/stock` | GET | Ver stock actual |
| `/api/inventario/historial` | GET | Ver historial |
| `/api/inventario/entrada` | POST | Registrar entrada |
| `/api/inventario/salida` | POST | Registrar salida |
| `/api/precios` | GET, POST | Gestión de precios |
| `/api/export` | GET | Exportar datos |

### Probar el Motor de Cálculo

```bash
curl -X POST http://localhost:3000/api/calculo/calcular \
  -H "Content-Type: application/json" \
  -d '{
    "productoId": "test",
    "tallaId": "test",
    "colegioId": "test",
    "pesoGramos": 200,
    "mermaPorcentaje": 8,
    "precioTelaUnitario": 15,
    "rendimientoTela": 1.5,
    "costoAccesorios": 5,
    "costoManoObra": 10,
    "factorComplejidad": 1,
    "costoFijo": 20,
    "costoIndirectoMensual": 500,
    "produccionTotalMes": 100,
    "precioVenta": 150
  }'
```

### Scripts Disponibles

| Comando | Descripción |
|---------|-------------|
| `pnpm dev:local` | Iniciar servidor local con sql.js |
| `pnpm dev` | Iniciar con Cloudflare Workers (requiere wrangler) |
| `pnpm db:seed` | Sembrar base de datos con datos de prueba |
| `pnpm db:generate` | Generar migraciones Drizzle |
| `pnpm db:push` | Push schema a D1 |
| `pnpm db:studio` | Abrir Drizzle Studio |

## Estructura del Proyecto

```
packages/
├── api/                    # Backend API
│   ├── src/
│   │   ├── database/       # Configuración DB (D1 / sql.js)
│   │   ├── middleware/      # Auth, RBAC
│   │   ├── routes/          # Endpoints API
│   │   ├── services/        # Lógica de negocio
│   │   │   └── calculo/     # Motor de cálculo
│   │   └── server.ts        # Servidor local
├── shared/                 # Tipos y constantes compartidas
└── web/                    # Frontend Next.js (pendiente)
```

## Próximos Pasos

1. Implementar CRUD real con base de datos
2. Conectar routes a drizzle queries
3. Implementar autenticación JWT
4. Crear frontend Next.js
