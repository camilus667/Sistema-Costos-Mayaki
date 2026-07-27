# Guía de Configuración Local

## 1. Instalar Node.js

Asegúrate de tener Node.js 18+ instalado:
```bash
node --version  # Debe mostrar v18.0.0 o superior
npm --version
```

## 2. Instalar Dependencias

En la raíz del proyecto:
```bash
npm install
```

Esto instalará dependencias en todos los paquetes del monorepo.

## 3. Configurar Cloudflare

### 3.1 Login
```bash
npx wrangler login
```

### 3.2 Crear Base de Datos D1
```bash
npx wrangler d1 create sistema-uniformes
```

Copia el database_id que se muestra (ej: "abc123-def456-ghi789")

### 3.3 Configurar wrangler.toml
```bash
cd packages/api
cp wrangler.example.toml wrangler.toml
```

Edita `wrangler.toml` y reemplaza `your-d1-database-id` con tu database_id real.

## 4. Inicializar Base de Datos

```bash
cd packages/api
npx wrangler d1 execute sistema-uniformes --file="../shared/src/database/init.sql" --remote
```

O usa el script de push:
```bash
npm run db:push
```

## 5. Variables de Entorno

Crea un archivo `.env` en `packages/api/`:

```env
JWT_SECRET=tu-secreto-muy-seguro-aqui-cambiar-en-produccion
NODE_VERSION=20
```

## 6. Ejecutar en Desarrollo

Desde la raíz del proyecto:
```bash
npm run dev
```

Esto iniciará:
- API en http://localhost:8787
- Frontend (cuando esté disponible) en http://localhost:3000

## 7. Verificar Instalación

```bash
curl http://localhost:8787/health
# Response: {"status":"ok","timestamp":"2024-..."}
```

## 8. Comandos Útiles

```bash
# Ver logs
npx wrangler tail

# Ver base de datos
npx wrangler d1 execute sistema-uniformes --command="SELECT * FROM colegio;"

# Crear migración
npm run db:generate

# Abrir Drizzle Studio (ORM GUI)
npm run db:studio
```

## Troubleshooting

### Error: "Cannot find module 'hono'"
```bash
cd packages/api
npm install
```

### Error: "D1 Database not found"
Verifica que `wrangler.toml` tenga el database_id correcto.

### Error: "TypeScript types for cloudflare"
```bash
cd packages/api
npm install --save-dev @cloudflare/workers-types
```
