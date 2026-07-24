import app from '../hono/hono';
import apiKeyService from '../service/api-key-service';
import result from '../model/result';
import userContext from '../security/user-context';

app.get('/my/api-key', async (c) => {
	const userId = userContext.getUserId(c);
	const apiKey = await apiKeyService.getOrGenerateApiKey(c, userId);
	return c.json(result.ok(apiKey));
});

app.post('/my/api-key/reset', async (c) => {
	const userId = userContext.getUserId(c);
	const apiKey = await apiKeyService.resetApiKey(c, userId);
	return c.json(result.ok(apiKey));
});
