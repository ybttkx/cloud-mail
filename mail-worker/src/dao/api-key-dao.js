let tableCreated = false;

const apiKeyDao = {
	async ensureTable(c) {
		if (tableCreated) return;
		try {
			await c.env.db.prepare(`
				CREATE TABLE IF NOT EXISTS user_api_key (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					user_id INTEGER NOT NULL,
					api_key TEXT NOT NULL UNIQUE,
					create_time TEXT DEFAULT CURRENT_TIMESTAMP
				)
			`).run();
			tableCreated = true;
		} catch (e) {
			console.error('ensureTable user_api_key error:', e);
		}
	},

	async getByUserId(c, userId) {
		await this.ensureTable(c);
		try {
			const { results } = await c.env.db.prepare(
				'SELECT id, user_id as userId, api_key as apiKey, create_time as createTime FROM user_api_key WHERE user_id = ? LIMIT 1'
			).bind(userId).all();
			return results && results.length > 0 ? results[0] : null;
		} catch (e) {
			return null;
		}
	},

	async getByApiKey(c, apiKey) {
		await this.ensureTable(c);
		try {
			const { results } = await c.env.db.prepare(
				'SELECT id, user_id as userId, api_key as apiKey, create_time as createTime FROM user_api_key WHERE api_key = ? LIMIT 1'
			).bind(apiKey).all();
			return results && results.length > 0 ? results[0] : null;
		} catch (e) {
			return null;
		}
	},

	async createOrUpdate(c, userId, apiKey) {
		await this.ensureTable(c);
		try {
			const existing = await this.getByUserId(c, userId);
			if (existing) {
				await c.env.db.prepare(
					'UPDATE user_api_key SET api_key = ?, create_time = CURRENT_TIMESTAMP WHERE user_id = ?'
				).bind(apiKey, userId).run();
			} else {
				await c.env.db.prepare(
					'INSERT INTO user_api_key (user_id, api_key) VALUES (?, ?)'
				).bind(userId, apiKey).run();
			}
			return await this.getByUserId(c, userId);
		} catch (e) {
			return null;
		}
	}
};

export default apiKeyDao;
