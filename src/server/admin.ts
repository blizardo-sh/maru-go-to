import { readConfig } from './config';
import { connectDatabase } from './db';
import { createLink } from './auth';
import { emailSchema } from './validation';
const config=readConfig(); const database=connectDatabase(config.DATABASE_URL);
const [action,emailInput]=process.argv.slice(2);
try {
 if(!emailInput||!['bootstrap','invite','recovery'].includes(action??'')) throw new Error('Usage: bun run admin bootstrap|invite|recovery email');
 const email=emailSchema.parse(emailInput);
 if(action==='bootstrap') {
  const [{count}]=await database.sql`select count(*)::int as count from users`;
  if(count!==0) throw new Error('Bootstrap allowed only before the first account. Use the admin page afterwards.');
 }
 const result=await createLink(database,action==='recovery'?'recovery':'invite',email,null);
 console.info(`${config.APP_URL}/${action==='recovery'?'recover':'invite'}#token=${result.token}`);
 console.info(`Expires: ${result.expiresAt}`);
 if(action==='bootstrap') console.info('The first accepted account becomes administrator.');
} finally { await database.sql.close(); }
