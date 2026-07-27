import type { Context, Next } from 'hono';

// Tipos comunes para la aplicación
export interface DatabaseBindings {
  DB: any; // D1Database en Cloudflare, SqlJsDatabase en local
}

export interface JwtBindings {
  JWT_SECRET: string;
}

// Combinar bindings
export type AppBindings = DatabaseBindings & JwtBindings;

// Context tipado para la aplicación
export type AppContext = Context<AppBindings, string>;
export type AppNext = Next;

// JWT Payload
export interface JwtPayload {
  userId: string;
  email: string;
  rol: string;
  colegioIds?: string[];
  iat: number;
  exp: number;
}

// Tipado para handlers de ruta con DB
export type RouteHandler<T = any, P extends string = string> = (
  c: Context<AppBindings, T, { params: { [K in P]: string } }>,
  next: Next
) => Promise<any> | any;

// Exportar types de Hono reutilizables
export type { Hono, Env } from 'hono';
