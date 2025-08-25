declare module 'csv-parser' {
  import { Transform } from 'stream';

  interface CsvParserOptions {
    separator?: string;
    quote?: string;
    escape?: string;
    newline?: string;
    headers?: boolean | string[] | ((headers: string[]) => string[]);
    mapHeaders?: (args: { header: string; index: number }) => string;
    mapValues?: (args: { header: string; index: number; value: string }) => any;
    skipEmptyLines?: boolean;
    skipLinesWithError?: boolean;
    maxRowBytes?: number;
    strict?: boolean;
  }

  function csv(options?: CsvParserOptions): Transform;
  export = csv;
}
