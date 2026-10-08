import { neon } from '@neondatabase/serverless';

export default async (req, context) => {
  const sql = neon(process.env.DATABASE_URL);
  
  const result = await sql`SELECT NOW()`;
  
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' }
  });
};