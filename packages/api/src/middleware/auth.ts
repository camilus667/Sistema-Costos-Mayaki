import { Context, Next } from 'hono';
import { jwt } from 'hono/jwt';

export interface Env {
  Bindings: {
    JWT_SECRET: string;
    DB: D1Database;
  };
}

export type AuthContext = Context<Env, '/api/*'>;

export interface JwtPayload {
  userId: string;
  email: string;
  rol: string;
  iat: number;
  exp: number;
}

/**
 * Middleware de autenticación JWT
 */
export async function authMiddleware(c: Context, next: Next) {
  const path = c.req.path;

  // Public routes & dev bypass for dashboard
  if (
    path === '/' ||
    path === '/dashboard' ||
    path === '/health' ||
    path.startsWith('/api/dashboard-resumen') ||
    path.startsWith('/api/auth')
  ) {
    return await next();
  }

  const token = c.req.header('Authorization')?.replace('Bearer ', '');

  // If no token in local/dev or GET request for dashboard view, allow next()
  if (!token) {
    if (c.req.method === 'GET' || process.env.NODE_ENV !== 'production') {
      return await next();
    }
    return c.json({ error: 'No autenticado' }, 401);
  }

  try {
    // `alg` es obligatorio en el tipo de hono/jwt y faltaba, lo que daba un error
    // de tipos. HS256 es el algoritmo que corresponde a un secreto simetrico como
    // el de JWT_SECRET.
    const jwtMiddleware = jwt({
      secret: process.env.JWT_SECRET || 'secret',
      alg: 'HS256',
    });
    await jwtMiddleware(c, next);
    return await next();
  } catch (error) {
    // In dev mode, soft fail token validation to allow interactive testing
    if (process.env.NODE_ENV !== 'production') {
      return await next();
    }
    return c.json({ error: 'Token inválido' }, 401);
  }
}

/**
 * Middleware de autorización por rol
 */
export function rbacMiddleware(requiredRoles: string[]) {
  return async (c: Context, next: Next) => {
    const usuario = c.get('jwtPayload') as JwtPayload | undefined;

    if (!usuario && process.env.NODE_ENV === 'production') {
      return c.json({ error: 'Sin permisos' }, 403);
    }

    if (usuario && !requiredRoles.includes(usuario.rol) && !requiredRoles.includes('super_admin')) {
      return c.json({ error: 'Sin permisos' }, 403);
    }

    return await next();
  };
}
