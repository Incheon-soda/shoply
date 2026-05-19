import { Pool } from 'pg';

export const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT) || 5432,
  database: process.env.POSTGRES_DB || 'shoply',
  user: process.env.POSTGRES_USER || 'shoply',
  password: process.env.POSTGRES_PASSWORD || 'shoply1234',
  max: 20,  // 동시성 처리 위해 커넥션 풀 넉넉히
});
