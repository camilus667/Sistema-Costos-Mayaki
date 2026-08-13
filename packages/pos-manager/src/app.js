import { Hono } from 'hono';
import { getDb } from '../../api/src/database/sqljs.ts';
import posRoutes from './routes/pos';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const app = new Hono();
// Inicializar BD
getDb();
// Servir styles.css del sistema principal
app.get('/styles.css', (c) => {
    try {
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const cssPath = path.resolve(__dirname, '../../api/src/public/styles.css');
        if (fs.existsSync(cssPath)) {
            return c.body(fs.readFileSync(cssPath, 'utf-8'), 200, { 'Content-Type': 'text/css' });
        }
    }
    catch (e) { }
    return c.text('/* styles fallback */', 200, { 'Content-Type': 'text/css' });
});
// Montar API del POS
app.route('/api/pos', posRoutes);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, 'public');
// Servir index.html en la raíz '/'
app.get('/', (c) => {
    const indexPath = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexPath)) {
        return c.html(fs.readFileSync(indexPath, 'utf-8'));
    }
    return c.text('Error: index.html no encontrado', 404);
});
// Servir frontend Vanilla POS
app.use('/*', async (c, next) => {
    const reqPath = c.req.path;
    if (reqPath.startsWith('/api') || reqPath === '/styles.css') {
        return next();
    }
    const fileName = reqPath.replace(/^\//, '');
    const filePath = path.join(publicDir, fileName);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentTypes = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'text/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.webp': 'image/webp',
        };
        const contentType = contentTypes[ext] || 'application/octet-stream';
        const data = fs.readFileSync(filePath);
        return c.body(data, 200, { 'Content-Type': contentType });
    }
    return next();
});
export default app;
//# sourceMappingURL=app.js.map