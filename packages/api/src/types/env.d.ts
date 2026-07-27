// Tipos para Cloudflare Workers
declare global {
  var D1Database: any;
  
  namespace CloudflareWorkersTypes {
    interface Env {
      JWT_SECRET: string;
      DB: D1Database;
    }
  }
}

// Tipos para Hono con database
import { type getDb } from './packages/api/src/database/sqljs';

export {};
