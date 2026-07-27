CREATE TABLE `accesorio` (
	`id` text PRIMARY KEY DEFAULT lower(hex(randomblob(16))) NOT NULL,
	`colegio_id` text NOT NULL,
	`descripcion` text NOT NULL,
	`codigo` text,
	`unidad_compra` text NOT NULL,
	`cantidad_x_ud` real NOT NULL,
	`costo_ud_compra` real NOT NULL,
	`costo_unitario` real NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`colegio_id`) REFERENCES `colegio`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `anio_escolar` (
	`id` text PRIMARY KEY DEFAULT lower(hex(randomblob(16))) NOT NULL,
	`colegio_id` text NOT NULL,
	`anio` text NOT NULL,
	`periodo` text,
	`activo` integer DEFAULT false,
	FOREIGN KEY (`colegio_id`) REFERENCES `colegio`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `auditoria` (
	`id` text PRIMARY KEY DEFAULT lower(hex(randomblob(16))) NOT NULL,
	`usuario_id` text,
	`colegio_id` text,
	`accion` text NOT NULL,
	`tabla` text NOT NULL,
	`registro_id` text,
	`datos_anteriores` text,
	`datos_nuevos` text,
	`creado_en` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`colegio_id`) REFERENCES `colegio`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `colegio` (
	`id` text PRIMARY KEY DEFAULT lower(hex(randomblob(16))) NOT NULL,
	`nombre` text NOT NULL,
	`direccion` text,
	`nit` text,
	`telefono` text,
	`activo` integer DEFAULT true NOT NULL,
	`creado_en` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `costo_indirecto` (
	`id` text PRIMARY KEY DEFAULT lower(hex(randomblob(16))) NOT NULL,
	`colegio_id` text NOT NULL,
	`anio_id` text,
	`concepto` text NOT NULL,
	`monto_mensual` real NOT NULL,
	FOREIGN KEY (`colegio_id`) REFERENCES `colegio`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`anio_id`) REFERENCES `anio_escolar`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `detalle_acc` (
	`id` text PRIMARY KEY DEFAULT lower(hex(randomblob(16))) NOT NULL,
	`producto_id` text NOT NULL,
	`accesorio_id` text NOT NULL,
	`cantidad_uso` real NOT NULL,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accesorio_id`) REFERENCES `accesorio`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `historico_precio` (
	`id` text PRIMARY KEY DEFAULT lower(hex(randomblob(16))) NOT NULL,
	`producto_id` text NOT NULL,
	`talla_id` text NOT NULL,
	`precio_anterior` real NOT NULL,
	`precio_nuevo` real NOT NULL,
	`cambio_por` text NOT NULL,
	`cambiado_por` text NOT NULL,
	`cambiado_en` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`talla_id`) REFERENCES `talla`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cambiado_por`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inventario` (
	`id` text PRIMARY KEY DEFAULT lower(hex(randomblob(16))) NOT NULL,
	`producto_id` text NOT NULL,
	`talla_id` text NOT NULL,
	`anio_id` text,
	`cantidad` integer DEFAULT 0 NOT NULL,
	`costo_unitario` real,
	`costo_total` real,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`talla_id`) REFERENCES `talla`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`anio_id`) REFERENCES `anio_escolar`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inventario_transaccion` (
	`id` text PRIMARY KEY DEFAULT lower(hex(randomblob(16))) NOT NULL,
	`producto_id` text NOT NULL,
	`talla_id` text NOT NULL,
	`anio_id` text,
	`tipo` text NOT NULL,
	`cantidad` integer NOT NULL,
	`costo_unitario` real,
	`motivo` text,
	`documento_referencia` text,
	`realizado_por` text NOT NULL,
	`creado_en` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`talla_id`) REFERENCES `talla`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`anio_id`) REFERENCES `anio_escolar`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`realizado_por`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `mano_obra` (
	`id` text PRIMARY KEY DEFAULT lower(hex(randomblob(16))) NOT NULL,
	`producto_id` text NOT NULL,
	`talla_id` text NOT NULL,
	`costo_bs` real NOT NULL,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`talla_id`) REFERENCES `talla`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `per_soles` (
	`id` text PRIMARY KEY DEFAULT lower(hex(randomblob(16))) NOT NULL,
	`colegio_id` text NOT NULL,
	`tipo_cambio` real NOT NULL,
	`vigente_desde` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`colegio_id`) REFERENCES `colegio`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `peso_mat_prima` (
	`id` text PRIMARY KEY DEFAULT lower(hex(randomblob(16))) NOT NULL,
	`producto_id` text NOT NULL,
	`talla_id` text NOT NULL,
	`peso_gramos` real NOT NULL,
	`merma_porcentaje` real DEFAULT 8 NOT NULL,
	`peso_con_merma` real NOT NULL,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`talla_id`) REFERENCES `talla`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `precio_venta` (
	`id` text PRIMARY KEY DEFAULT lower(hex(randomblob(16))) NOT NULL,
	`producto_id` text NOT NULL,
	`talla_id` text NOT NULL,
	`precio_bs` real NOT NULL,
	`vigente_desde` text DEFAULT CURRENT_TIMESTAMP,
	`vigente_hasta` text,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`talla_id`) REFERENCES `talla`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `producto` (
	`id` text PRIMARY KEY DEFAULT lower(hex(randomblob(16))) NOT NULL,
	`colegio_id` text NOT NULL,
	`anio_id` text,
	`item_numero` integer NOT NULL,
	`descripcion` text NOT NULL,
	`factor_complejidad` integer DEFAULT 1,
	`costo_fijo` real DEFAULT 0,
	`activo` integer DEFAULT true NOT NULL,
	`creado_en` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`colegio_id`) REFERENCES `colegio`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`anio_id`) REFERENCES `anio_escolar`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `talla` (
	`id` text PRIMARY KEY DEFAULT lower(hex(randomblob(16))) NOT NULL,
	`colegio_id` text NOT NULL,
	`codigo` text NOT NULL,
	`nombre` text NOT NULL,
	`orden` integer NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`colegio_id`) REFERENCES `colegio`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tela` (
	`id` text PRIMARY KEY DEFAULT lower(hex(randomblob(16))) NOT NULL,
	`colegio_id` text NOT NULL,
	`descripcion` text NOT NULL,
	`rendimiento` real NOT NULL,
	`ancho_mts` real,
	`densidad_g_m2` real,
	`precio_compra` real NOT NULL,
	`precio_unitario` real NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`colegio_id`) REFERENCES `colegio`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `usuario_colegio` (
	`id` text PRIMARY KEY DEFAULT lower(hex(randomblob(16))) NOT NULL,
	`usuario_id` text NOT NULL,
	`colegio_id` text NOT NULL,
	`rol_colegio` text NOT NULL,
	`creado_en` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`colegio_id`) REFERENCES `colegio`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `usuario` (
	`id` text PRIMARY KEY DEFAULT lower(hex(randomblob(16))) NOT NULL,
	`nombre` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`rol` text NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	`creado_en` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usuario_email_unique` ON `usuario` (`email`);