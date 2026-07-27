import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, asc } from 'drizzle-orm';
import { usuarios } from '../database/schema';
import * as bcrypt from 'bcrypt-ts';

const api = new Hono();

// Esquema de creación de usuario
const crearUsuarioSchema = z.object({
  nombre: z.string().min(1).max(255),
  email: z.string().email(),
  password: z.string().min(8),
  rol: z.enum(['super_admin', 'admin', 'editor', 'visualizador']),
});

// GET /api/usuarios - Listar usuarios
api.get('/', async (c) => {
  const db = (c as any).db;
  const allUsuarios = await db.select().from(usuarios).orderBy(asc(usuarios.nombre));
  
  // No devolver passwords
  const usuariosSinPassword = allUsuarios.map((u: any) => {
    const { passwordHash, ...usuario } = u;
    return usuario;
  });
  
  return c.json({
    success: true,
    data: usuariosSinPassword,
  });
});

// GET /api/usuarios/:id - Obtener usuario por ID
api.get('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  
  const [usuario] = await db
    .select()
    .from(usuarios)
    .where(eq(usuarios.id, id))
    .limit(1);
  
  if (!usuario) {
    return c.json({ success: false, error: 'Usuario no encontrado' }, 404);
  }
  
  const { passwordHash, ...usuarioSinPassword } = usuario;
  
  return c.json({
    success: true,
    data: usuarioSinPassword,
  });
});

// POST /api/usuarios - Crear usuario
api.post('/', zValidator('json', crearUsuarioSchema), async (c) => {
  const db = (c as any).db;
  const body = c.req.valid('json');
  
  // Hash de contraseña
  const passwordHash = await bcrypt.hash(body.password, 10);
  
  const [newUsuario] = await db.insert(usuarios)
    .values({
      nombre: body.nombre,
      email: body.email,
      passwordHash,
      rol: body.rol,
    })
    .returning();
  
  const { passwordHash: _, ...usuarioSinPassword } = newUsuario;
  
  return c.json({
    success: true,
    data: usuarioSinPassword,
    message: 'Usuario creado exitosamente',
  }, 201);
});

// PUT /api/usuarios/:id - Actualizar usuario
api.put('/:id', zValidator('json', crearUsuarioSchema.partial()), async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const body: any = c.req.valid('json');
  
  // Si se está cambiando la contraseña, hashear
  if (body.password) {
    body.passwordHash = await bcrypt.hash(body.password, 10);
    delete body.password;
  }
  
  const [updatedUsuario] = await db
    .update(usuarios)
    .set(body)
    .where(eq(usuarios.id, id))
    .returning();
  
  if (!updatedUsuario) {
    return c.json({ success: false, error: 'Usuario no encontrado' }, 404);
  }
  
  const { passwordHash: _, ...usuarioSinPassword } = updatedUsuario;
  
  return c.json({
    success: true,
    data: usuarioSinPassword,
    message: 'Usuario actualizado exitosamente',
  });
});

// DELETE /api/usuarios/:id - Eliminar usuario
api.delete('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  
  const [deletedUsuario] = await db
    .delete(usuarios)
    .where(eq(usuarios.id, id))
    .returning();
  
  if (!deletedUsuario) {
    return c.json({ success: false, error: 'Usuario no encontrado' }, 404);
  }
  
  return c.json({
    success: true,
    message: 'Usuario eliminado exitosamente',
  });
});

export default api;
