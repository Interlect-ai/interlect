/**
 * The part of node-postgres the customer scripts use, so `npm run typecheck:scripts` can check
 * them without adding @types/pg (a deleted helper slipped past CI because scripts were never
 * typechecked).
 */
declare module "pg" {
  namespace pg {
    interface QueryResult<R> {
      rows: R[];
      rowCount: number | null;
    }
    interface ClientConfig {
      connectionString?: string;
      ssl?: boolean | { rejectUnauthorized?: boolean; ca?: string } | undefined;
    }
    class Client {
      constructor(config?: ClientConfig);
      connect(): Promise<void>;
      query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
      end(): Promise<void>;
    }
  }
  export = pg;
}
