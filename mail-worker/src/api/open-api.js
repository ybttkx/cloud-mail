import app from '../hono/hono';
import apiKeyService from '../service/api-key-service';
import emailService from '../service/email-service';
import accountService from '../service/account-service';
import userService from '../service/user-service';
import result from '../model/result';

app.post('/open/send', async (c) => {
	let apiKey = c.req.header('X-API-Key');
	if (!apiKey) {
		const auth = c.req.header('Authorization');
		if (auth && auth.startsWith('Bearer ')) {
			apiKey = auth.substring(7).trim();
		}
	}

	if (!apiKey) {
		return c.json(result.fail('API Key 为空，请在 Request Header 中传入 X-API-Key 或 Authorization: Bearer <API_KEY>'), 401);
	}

	const userId = await apiKeyService.getUserByApiKey(c, apiKey);
	if (!userId) {
		return c.json(result.fail('无效的 API Key'), 401);
	}

	const body = await c.req.json();
	let {
		accountId,
		name,
		sendType,
		emailId,
		to,
		receiveEmail,
		text,
		content,
		subject,
		attachments
	} = body;

	// 统一处理收件人参数
	let targetReceivers = receiveEmail;
	if (!targetReceivers) {
		if (Array.isArray(to)) {
			targetReceivers = to;
		} else if (typeof to === 'string' && to.trim() !== '') {
			targetReceivers = [to.trim()];
		}
	}

	if (!targetReceivers || targetReceivers.length === 0) {
		return c.json(result.fail('收件人邮箱 (to 或 receiveEmail) 不能为空'), 400);
	}

	// 若未显式提供 accountId，则自动绑定该用户的默认账号
	if (!accountId) {
		const userRow = await userService.selectById(c, userId);
		if (userRow) {
			const account = await accountService.selectByEmailIncludeDel(c, userRow.email);
			if (account) {
				accountId = account.accountId;
			}
		}
	}

	if (!accountId) {
		return c.json(result.fail('未指定发件账号 ID 且无法自动关联默认发件邮箱'), 400);
	}

	const sendParams = {
		accountId,
		name,
		sendType,
		emailId,
		receiveEmail: targetReceivers,
		text: text || '',
		content: content || text || '',
		subject: subject || '(无主题)',
		attachments: attachments || []
	};

	const emailResult = await emailService.send(c, sendParams, userId);
	return c.json(result.ok(emailResult));
});
