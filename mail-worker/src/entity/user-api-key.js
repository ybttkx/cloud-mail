import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const userApiKey = sqliteTable('user_api_key', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull(),
	apiKey: text('api_key').notNull().unique(),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`)
});

export default userApiKey;
