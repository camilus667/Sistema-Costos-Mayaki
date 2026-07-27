# Sistema de Gestión de Uniformes Escolares

Sistema web multi-colegio para la gestión, cálculo y análisis de costos de producción de uniformes escolares.

## 🏗️ Arquitectura

- **Frontend**: Next.js + React (Cloudflare Pages)
- **Backend**: Cloudflare Workers + Hono.js
- **Base de Datos**: Cloudflare D1 (SQLite) + Drizzle ORM
- **Autenticación**: JWT
- **Monorepo**: Turborepo + pnpm

## ✅ Estado Actual

- [x] Estructura del proyecto creada
- [x] Dependencias instaladas (276 paquetes)
- [x] Schema de base de datos definido (18 tablas)
- [x] Motor de cálculo implementado
- [x] Middleware de autenticación JWT
- [x] Rutas API creadas (stub)
- [ ] Conectar rutas con D1
- [ ] Frontend Next.js
- [ ] Testing

## 📦 Estructura del Proyecto

```
sistema-uniformes/
├── packages/
│   ├── shared/          # Tipos, constantes, utilidades compartidas ✅
│   ├── api/             # Backend - Cloudflare Workers ✅
│   └── web/             # Frontend - Next.js (próximamente)
├── pnpm-workspace.yaml  ✅
├── package.json         ✅
├── turbo.json           ✅
└── node_modules/        ✅ (276 paquetes instalados)
```

## 🚀 Tecnologías

| Componente | Tecnología |
|------------|-----------|
| Runtime | Cloudflare Workers |
| Framework API | Hono.js |
| Base de Datos | Cloudflare D1 (SQLite) |
| ORM | Drizzle ORM |
| Validación | Zod |
| Autenticación | JWT |
| Frontend | Next.js 14 + React 18 |
| Package Manager | pnpm |
| Build | Turborepo |

## 📋 Requisitos

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- Cuenta de Cloudflare (gratis para empezar)

## 🔧 Instalación

```bash
# Instalar pnpm globalmente
npm install -g pnpm

# Instalar dependencias
pnpm install

# Configurar Cloudflare
wrangler login

# Crear base de datos D1
wrangler d1 create sistema-uniformes

# Configurar wrangler.toml
cd packages/api
cp wrangler.example.toml wrangler.toml
# Actualizar database_id en wrangler.toml

# Iniciar desarrollo
pnpm run dev
```

## 📡 API Endpoints

| Método | Endpoint | Estado |
|--------|----------|--------|
| GET | `/health` | ✅ Implementado |
| POST | `/api/auth/login` | 🔜 Próximamente |
| GET | `/api/colegios` | 🔜 Conectar D1 |
| POST | `/api/colegios` | 🔜 Conectar D1 |
| POST | `/api/calculo/calcular` | ✅ Motor implementado |
| GET | `/api/inventario/stock` | 🔜 Conectar D1 |
| POST | `/api/inventario/entrada` | 🔜 Conectar D1 |

## 📊 Motor de Cálculo

El sistema replica la lógica del Excel CAMBRIDGE.xlsx:

```
Peso + Merma → Costo Tela → + Accesorios → + Mano de Obra
= Costo Bruto → + Costos Fijos → + Costos Indirectos
= Costo Antes Impuestos → + 13% IVA = Costo Total
```

## 🚢 Despliegue

```bash
# Desplegar API
cd packages/api
wrangler deploy

# Desplegar Frontend
cd packages/web
pnpm run build
wrangler pages deploy .next
```

## 📝 Licencia

Propiedad de MAYAKI
