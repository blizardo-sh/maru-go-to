import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Compatibility fixtures only; application migrations will have their own schema.
const times = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const user = pgTable('probe_user', {
  id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false), image: text('image'), ...times(),
});
export const session = pgTable('probe_session', {
  id: text('id').primaryKey(), token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), ipAddress: text('ip_address'),
  userAgent: text('user_agent'), userId: text('user_id').notNull().references(() => user.id), ...times(),
});
export const account = pgTable('probe_account', {
  id: text('id').primaryKey(), accountId: text('account_id').notNull(), providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id), accessToken: text('access_token'),
  refreshToken: text('refresh_token'), idToken: text('id_token'), scope: text('scope'), password: text('password'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }), ...times(),
});
export const verification = pgTable('probe_verification', {
  id: text('id').primaryKey(), identifier: text('identifier').notNull(), value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), ...times(),
});
export const state = pgTable('probe_state', {
  id: text('id').primaryKey(), revision: integer('revision').notNull().default(1),
});
