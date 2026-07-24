import apiKeyDao from '../dao/api-key-dao';
import cryptoUtils from '../utils/crypto-utils';

const apiKeyService = {
	async getOrGenerateApiKey(c, userId) {
		let item = await apiKeyDao.getByUserId(c, userId);
		if (!item) {
			const randomBytes = new Uint8Array(24);
			crypto.getRandomValues(randomBytes);
			const apiKey = 'cm_sk_' + Array.from(randomBytes, b => b.toString(16).padStart(2, '0')).join('');
			item = await apiKeyDao.createOrUpdate(c, userId, apiKey);
		}
		return item.apiKey;
	},

	async resetApiKey(c, userId) {
		const randomBytes = new Uint8Array(24);
		crypto.getRandomValues(randomBytes);
		const newApiKey = 'cm_sk_' + Array.from(randomBytes, b => b.toString(16).padStart(2, '0')).join('');
		const item = await apiKeyDao.createOrUpdate(c, userId, newApiKey);
		return item.apiKey;
	},

	async getUserByApiKey(c, apiKey) {
		if (!apiKey) return null;
		const item = await apiKeyDao.getByApiKey(c, apiKey);
		return item ? item.userId : null;
	}
};

export default apiKeyService;
