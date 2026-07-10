import orm from '../entity/orm';
import email from '../entity/email';
import settingService from './setting-service';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
dayjs.extend(utc);
dayjs.extend(timezone);
import { eq } from 'drizzle-orm';
import jwtUtils from '../utils/jwt-utils';
import emailMsgTemplate from '../template/email-msg';
import emailTextTemplate from '../template/email-text';
import emailHtmlTemplate from '../template/email-html';
import verifyUtils from '../utils/verify-utils';
import domainUtils from "../utils/domain-uitls";

const telegramService = {

	async getEmailContent(c, params) {

		const { token } = params

		const result = await jwtUtils.verifyToken(c, token);

		if (!result) {
			return emailTextTemplate('Access denied')
		}

		const emailRow = await orm(c).select().from(email).where(eq(email.emailId, result.emailId)).get();

		if (emailRow) {

			if (emailRow.content) {
				const { r2Domain } = await settingService.query(c);
				return emailHtmlTemplate(emailRow.content || '', r2Domain)
			} else {
				return emailTextTemplate(emailRow.text || '')
			}

		} else {
			return emailTextTemplate('The email does not exist')
		}

	},

	async sendEmailToBot(c, email) {

		const { tgBotToken, tgChatId, customDomain, tgMsgTo, tgMsgFrom, tgMsgText } = await settingService.query(c);

		const tgChatIds = tgChatId.split(',');

		const jwtToken = await jwtUtils.generateToken(c, { emailId: email.emailId })

		const webAppUrl = customDomain ? `${domainUtils.toOssDomain(customDomain)}/api/telegram/getEmail/${jwtToken}` : 'https://www.cloudflare.com/404'

		await Promise.all(tgChatIds.map(async chatId => {
			try {
				const res = await fetch(`https://api.telegram.org/bot${tgBotToken}/sendMessage`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						chat_id: chatId,
						parse_mode: 'HTML',
						text: emailMsgTemplate(email, tgMsgTo, tgMsgFrom, tgMsgText),
						reply_markup: {
							inline_keyboard: [
								[
									{
										text: '查看',
										web_app: { url: webAppUrl }
									}
								]
							]
						}
					})
				});
				if (res.ok) {
					const data = await res.json();
					if (data.ok && data.result && data.result.message_id) {
						await c.env.kv.put(`tg_msg_map:${chatId}:${data.result.message_id}`, String(email.emailId), { expirationTtl: 60 * 60 * 24 * 7 });
					}
				} else {
					console.error(`转发 Telegram 失败 status: ${res.status} response: ${await res.text()}`);
				}
			} catch (e) {
				console.error(`转发 Telegram 失败:`, e.message);
			}
		}));

	},

	async handleWebhook(c, body) {
		if (!body || !body.message) {
			return;
		}

		const message = body.message;
		const chatId = message.chat.id;
		const text = message.text;

		const { tgBotToken, tgChatId } = await settingService.query(c);

		const tgChatIds = tgChatId.split(',');
		if (!tgChatIds.includes(String(chatId))) {
			console.warn(`Unauthorized Telegram chat ID attempt: ${chatId}`);
			return;
		}

		const sendTelegramReply = async (replyText) => {
			try {
				await fetch(`https://api.telegram.org/bot${tgBotToken}/sendMessage`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						chat_id: chatId,
						text: replyText,
						parse_mode: 'HTML',
						reply_to_message_id: message.message_id
					})
				});
			} catch (e) {
				console.error(`Failed to send Telegram message:`, e.message);
			}
		};

		if (!text) {
			await sendTelegramReply(`⚠️ 目前仅支持回复文本消息！`);
			return;
		}

		if (text.startsWith('/start') || text.startsWith('/help')) {
			const helpMsg = `📧 <b>Cloud Mail Bot 使用帮助</b>\n\n` +
				`<b>1. 直接回复邮件</b>\n` +
				`当收到新邮件通知时，直接在该消息下使用 Telegram <b>回复 (Reply)</b> 功能，你的回复内容将自动以邮件形式发件给原发件人。\n\n` +
				`<b>2. 主动发送邮件</b>\n` +
				`格式：<code>/send &lt;收件人邮箱&gt; &lt;主题&gt; - &lt;邮件内容&gt;</code>\n` +
				`例如：<code>/send test@example.com 你好 - 这是来自 Telegram 的邮件</code>`;
			await sendTelegramReply(helpMsg);
			return;
		}

		if (text.startsWith('/send')) {
			const match = text.match(/^\/send\s+(\S+)\s+(.+?)\s+-\s+(.+)$/s);
			if (!match) {
				await sendTelegramReply(`⚠️ <b>格式错误</b>\n请使用格式：<code>/send &lt;收件人邮箱&gt; &lt;主题&gt; - &lt;邮件内容&gt;</code>`);
				return;
			}

			const toEmail = match[1];
			const subject = match[2].trim();
			const content = match[3].trim();

			if (!verifyUtils.isEmail(toEmail)) {
				await sendTelegramReply(`❌ <b>收件人邮箱格式不正确:</b> <code>${toEmail}</code>`);
				return;
			}

			try {
				const emailService = (await import('./email-service')).default;
				const accountService = (await import('./account-service')).default;
				const userService = (await import('./user-service')).default;

				const adminUser = await userService.selectByEmailIncludeDel(c, c.env.admin);
				if (!adminUser) {
					throw new Error('未配置系统管理员账户');
				}

				const adminAccount = await accountService.selectByEmailIncludeDel(c, c.env.admin);
				const sendAccount = adminAccount || await accountService.selectFirstByUserId(c, adminUser.userId);
				if (!sendAccount) {
					throw new Error('管理员未绑定任何发信邮箱账号');
				}

				const sendParams = {
					accountId: sendAccount.accountId,
					name: sendAccount.name,
					sendType: 'send',
					receiveEmail: [toEmail],
					text: content,
					content: content,
					subject: subject,
					attachments: []
				};

				await emailService.send(c, sendParams, adminUser.userId);
				await sendTelegramReply(`✅ <b>邮件发送成功！</b>\n<b>收件人:</b> ${toEmail}\n<b>主题:</b> ${subject}`);
			} catch (err) {
				await sendTelegramReply(`❌ <b>邮件发送失败:</b> ${err.message}`);
			}
			return;
		}

		if (message.reply_to_message) {
			const replyToMessageId = message.reply_to_message.message_id;
			const emailId = await c.env.kv.get(`tg_msg_map:${chatId}:${replyToMessageId}`);

			if (!emailId) {
				await sendTelegramReply(`⚠️ <b>无法回复此邮件:</b> 找不到与该消息匹配的邮件记录，可能已过期（映射仅保留 7 天）。`);
				return;
			}

			try {
				const emailService = (await import('./email-service')).default;
				const originalEmail = await emailService.selectById(c, Number(emailId));

				if (!originalEmail) {
					await sendTelegramReply(`❌ <b>邮件发送失败:</b> 邮件在数据库中的记录已不存在`);
					return;
				}

				const toEmail = originalEmail.sendEmail;
				const subject = originalEmail.subject.toLowerCase().startsWith('re:') ? originalEmail.subject : `Re: ${originalEmail.subject}`;

				const accountService = (await import('./account-service')).default;
				const sendAccount = await accountService.selectById(c, originalEmail.accountId);

				if (!sendAccount) {
					await sendTelegramReply(`❌ <b>邮件发送失败:</b> 无法确定发信账号（可能该账号已被删除）`);
					return;
				}

				const sendParams = {
					accountId: sendAccount.accountId,
					name: sendAccount.name,
					sendType: 'reply',
					emailId: originalEmail.emailId,
					receiveEmail: [toEmail],
					text: text,
					content: text,
					subject: subject,
					attachments: []
				};

				await emailService.send(c, sendParams, originalEmail.userId);
				await sendTelegramReply(`✅ <b>回复发送成功！</b>\n<b>收信人:</b> ${toEmail}\n<b>主题:</b> ${subject}`);
			} catch (err) {
				await sendTelegramReply(`❌ <b>回复发送失败:</b> ${err.message}`);
			}
			return;
		}

		await sendTelegramReply(`ℹ️ <b>未识别操作</b>\n你可以直接使用 Telegram 的“回复”功能回复某封邮件通知；或者使用 <code>/help</code> 菜单查看帮助。`);
	}

}

export default telegramService
