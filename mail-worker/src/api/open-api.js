import app from '../hono/hono';
import apiKeyService from '../service/api-key-service';
import emailService from '../service/email-service';
import accountService from '../service/account-service';
import userService from '../service/user-service';
import result from '../model/result';
import orm from '../entity/orm';
import account from '../entity/account';
import { eq, and } from 'drizzle-orm';
import { isDel } from '../const/entity-const';
import settingService from '../service/setting-service';
import emailUtils from '../utils/email-utils';
import verifyUtils from '../utils/verify-utils';

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
		from, // 支持全局任意指定发件人邮箱 (例如 admin@ybovo.com)
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
	const requestedFrom = typeof from === 'string' ? from.trim() : '';
	const hasFrom = from !== undefined && from !== null && from !== '';

	if (hasFrom && !verifyUtils.isEmail(requestedFrom)) {
		return c.json(result.fail('发件人邮箱格式不正确'), 400);
	}

	const userRow = await userService.selectById(c, userId);
	const isAdmin = userRow && userRow.email.toLowerCase() === String(c.env.admin).toLowerCase();
	if (hasFrom) {
		const { domainList } = await settingService.query(c);
		const requestedDomain = '@' + emailUtils.getDomain(requestedFrom).toLowerCase();
		if (!domainList.some(domain => domain.toLowerCase() === requestedDomain)) {
			return c.json(result.fail('发件人域名未配置'), 403);
		}
	}

	// 1. 统一处理收件人参数
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

	// 2. 发件人邮箱与 accountId 全局关联与绑定
	if (hasFrom) {
		// 尝试匹配已有的账号 ID
		const existAccount = await orm(c).select().from(account)
			.where(and(eq(account.email, requestedFrom), eq(account.userId, userId), eq(account.isDel, isDel.NORMAL)))
			.get();
		if (existAccount) {
			accountId = existAccount.accountId;
		} else if (!isAdmin) {
			return c.json(result.fail('普通用户只能使用自己拥有的发件账号'), 403);
		}
	}

	// 若未找到指定 accountId，使用用户的默认主账号
	if (!accountId) {
		const userRow = await userService.selectById(c, userId);
		if (userRow) {
			const acc = await accountService.selectByEmailIncludeDel(c, userRow.email);
			if (acc) {
				accountId = acc.accountId;
			}
		}
	}

	if (!accountId) {
		return c.json(result.fail('系统未匹配到可用的默认发件账号'), 400);
	}

	const sendParams = {
		accountId,
		name: name || (requestedFrom ? requestedFrom.split('@')[0] : ''),
		senderEmail: hasFrom ? requestedFrom : '',
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
