import { z } from 'zod';
export const configSchema = z.object({
  AUTH_COOKIE_PREFIX: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional(),
  DATABASE_URL: z.url().refine(v=>/^postgres(ql)?:/.test(v)),
  BETTER_AUTH_SECRET:z.string().min(32), APP_URL:z.url(), PORT:z.coerce.number().int().min(1).max(65535).default(3000), HOST:z.string().default('127.0.0.1'),
  SMTP_HOST:z.string().min(1).optional(), SMTP_PORT:z.coerce.number().refine(value=>value===465||value===587).optional(),
  SMTP_USER:z.email().optional(), SMTP_PASSWORD:z.string().min(1).optional(), MAIL_FROM:z.email().optional(),
  ANALYSIS_PROVIDER:z.enum(['openrouter','generic']).optional(), OPENROUTER_API_KEY:z.string().min(1).optional(), OPENROUTER_MODEL:z.string().min(1).optional(),
  ANALYSIS_URL:z.url().optional(), ANALYSIS_MODEL:z.string().min(1).optional(), ANALYSIS_API_KEY:z.string().optional(), ANALYSIS_FREE_ONLY:z.enum(['true']).optional(),
}).superRefine((value,ctx)=>{const values=[value.SMTP_HOST,value.SMTP_USER,value.SMTP_PASSWORD,value.MAIL_FROM];if(values.some(Boolean)&&!values.every(Boolean))ctx.addIssue({code:'custom',message:'Configure all SMTP credentials and MAIL_FROM together.'});});
export type Config = z.infer<typeof configSchema>;
export function readConfig() { return configSchema.parse(Object.fromEntries(Object.entries(process.env).filter(([,value])=>value!==''))); }
