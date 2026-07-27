declare module 'sql.js' {
  interface Database {
    run(sql: string, params?: any[]): void;
    prepare(sql: string): any;
    exec(sql: string): any[];
    export(): Uint8Array;
    each(sql: string, params?: any[], callback: (row: any) => void, done: () => void, error?: (err: Error) => void): void;
  }
  
  interface SqlJs {
    new (buffer?: Uint8Array | ArrayBuffer | null): Database;
  }
  
  function initSqlJs(config: { locateFile: (file: string) => string }): Promise<any>;
  
  export default { initSqlJs };
}
