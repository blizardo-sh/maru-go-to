import { z } from 'zod';
export const configSchema = z.object({
  DATABASE_URL: z.url().refine(v=>/^postgres(ql)?:/.test(v)),
  BETTER_AUTH_SECRET:z.string().min(32), APP_URL:z.url(), PORT:z.coerce.number().int().min(1).max(65535).default(3000), HOST:z.string().default('127.0.0.1'),
  ANALYSIS_PROVIDER:z.enum(['openrouter','generic']).optional(), OPENROUTER_API_KEY:z.string().min(1).optional(), OPENROUTER_MODEL:z.string().min(1).optional(),
  ANALYSIS_URL:z.url().optional(), ANALYSIS_MODEL:z.string().min(1).optional(), ANALYSIS_API_KEY:z.string().optional(), ANALYSIS_FREE_ONLY:z.enum(['true']).optional(),
});
export type Config = z.infer<typeof configSchema>;
export function readConfig() { return configSchema.parse(Object.fromEntries(Object.entries(process.env).filter(([,value])=>value!==''))); }
