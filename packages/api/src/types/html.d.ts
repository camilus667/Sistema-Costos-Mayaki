/**
 * `index.ts` hace `import dashboardHtml from './dashboard.html'`, que funciona en
 * runtime porque el bundler de Workers inlinea el archivo como string, pero
 * TypeScript no tiene forma de saberlo y daba TS2307: "Cannot find module
 * './dashboard.html' or its corresponding type declarations".
 *
 * Esta declaracion se lo dice. No cambia nada en runtime.
 */
declare module '*.html' {
  const contenido: string;
  export default contenido;
}
