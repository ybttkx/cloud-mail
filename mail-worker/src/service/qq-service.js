import settingService from './setting-service';
import jwtUtils from '../utils/jwt-utils';
import domainUtils from '../utils/domain-uitls';
import emailUtils from '../utils/email-utils';

const TOKEN_KEY = 'qq:official:access-token';
const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';
const API_URL = 'https://api.sgroup.qq.com';
const GROUP_OPENID_KEY = 'qq:official:group-openid';

const qqService = {
	async getAccessToken(c) {
		const { QQ_BOT_APP_ID: appId, QQ_BOT_APP_SECRET: clientSecret } = c.env;
		if (!appId || !clientSecret) return null;

		const cached = await c.env.kv.get(TOKEN_KEY, { type: 'json' });
		if (cached?.accessToken && cached.expiresAt > Date.now() + 60 * 1000) {
			return cached.accessToken;
		}

		const response = await fetch(TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ appId, clientSecret })
		});

		if (!response.ok) {
			console.error(`获取 QQ Access Token 失败: ${response.status} ${await response.text()}`);
			return null;
		}

		const data = await response.json();
		if (!data.access_token || !data.expires_in) {
			console.error('获取 QQ Access Token 失败: 响应缺少 access_token');
			return null;
		}

		await c.env.kv.put(TOKEN_KEY, JSON.stringify({
			accessToken: data.access_token,
			expiresAt: Date.now() + data.expires_in * 1000
		}), { expirationTtl: Math.max(60, data.expires_in - 60) });

		return data.access_token;
	},

	async sendEmailToGroup(c, email) {
		const groupId = await c.env.kv.get(GROUP_OPENID_KEY) || c.env.QQ_BOT_GROUP_ID;
		if (!groupId) return;

		try {
			const accessToken = await this.getAccessToken(c);
			if (!accessToken) return;

			const { customDomain } = await settingService.query(c);
			const token = await jwtUtils.generateToken(c, { emailId: email.emailId });
			const webAppUrl = customDomain
				? `${domainUtils.toOssDomain(customDomain)}/api/telegram/getEmail/${token}`
				: '';
			const text = emailUtils.formatText(email.text) || emailUtils.htmlToText(email.content);
			const content = [
				'📧 收到新邮件',
				`发件人：${email.name || email.sendEmail} <${email.sendEmail}>`,
				`收件人：${email.toEmail}`,
				`主题：${email.subject || '(无主题)'}`,
				text ? `\n${text.slice(0, 1200)}` : '',
				webAppUrl ? `\n查看邮件：${webAppUrl}` : ''
			].filter(Boolean).join('\n');

			const response = await fetch(`${API_URL}/v2/groups/${encodeURIComponent(groupId)}/messages`, {
				method: 'POST',
				headers: {
					'Authorization': `QQBot ${accessToken}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ content, msg_type: 0 })
			});

			if (!response.ok) {
				console.error(`转发 QQ 失败 status: ${response.status} response: ${await response.text()}`);
			}
		} catch (e) {
			console.error('转发 QQ 失败:', e.message);
		}
	}
};

export default qqService;
