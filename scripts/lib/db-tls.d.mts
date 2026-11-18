export const SUPABASE_CA_PATH: string;
export function isSupabaseHost(databaseUrl: string): boolean;
export function pgConfig(databaseUrl: string): {
  connectionString: string;
  ssl?: { ca: string; rejectUnauthorized: true };
};
export function libpqUrl(databaseUrl: string): string;
