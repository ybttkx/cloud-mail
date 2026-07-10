import orm from '../entity/orm';
import email from '../entity/email';
import settingService from './setting-service';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
dayjs.extend(utc);
dayjs.extend(timezone);
import { eq, and } from 'drizzle-orm';
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
		if (!body) {
			return;
		}

		let chatId = null;
		let message = body.message;
		let callbackQuery = body.callback_query;
		let text = null;
		let callbackData = null;
		let callbackQueryId = null;
		let messageId = null;

		if (message) {
			chatId = message.chat.id;
			text = message.text;
			messageId = message.message_id;
		} else if (callbackQuery) {
			chatId = callbackQuery.message.chat.id;
			callbackData = callbackQuery.data;
			callbackQueryId = callbackQuery.id;
			messageId = callbackQuery.message.message_id;
		} else {
			return;
		}

		const { tgBotToken, tgChatId } = await settingService.query(c);

		const tgChatIds = tgChatId.split(',');
		if (!tgChatIds.includes(String(chatId))) {
			console.warn(`Unauthorized Telegram chat ID attempt: ${chatId}`);
			return;
		}

		const sendTelegramReply = async (replyText, replyMarkup = null) => {
			try {
				const bodyObj = {
					chat_id: chatId,
					text: replyText,
					parse_mode: 'HTML'
				};
				if (messageId && message) {
					bodyObj.reply_to_message_id = messageId;
				}
				if (replyMarkup) {
					bodyObj.reply_markup = replyMarkup;
				}
				await fetch(`https://api.telegram.org/bot${tgBotToken}/sendMessage`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify(bodyObj)
				});
			} catch (e) {
				console.error(`Failed to send Telegram message:`, e.message);
			}
		};

		const editTelegramMessage = async (msgId, replyText, replyMarkup = null) => {
			try {
				const bodyObj = {
					chat_id: chatId,
					message_id: msgId,
					text: replyText,
					parse_mode: 'HTML'
				};
				if (replyMarkup) {
					bodyObj.reply_markup = replyMarkup;
				}
				await fetch(`https://api.telegram.org/bot${tgBotToken}/editMessageText`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify(bodyObj)
				});
			} catch (e) {
				console.error(`Failed to edit Telegram message:`, e.message);
			}
		};

		const answerCallback = async (cbQueryId) => {
			try {
				await fetch(`https://api.telegram.org/bot${tgBotToken}/answerCallbackQuery`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ callback_query_id: cbQueryId })
				});
			} catch (e) {
				console.error(`Failed to answer callback query:`, e.message);
			}
		};

		// 1. Process Callback Queries (Buttons)
		if (callbackQuery && callbackData) {
			if (callbackData.startsWith('tg_cb:sender:')) {
				const senderEmail = callbackData.replace('tg_cb:sender:', '');
				
				// Initialize/Update session
				const sessionObj = {
					step: 'recipient',
					sender: senderEmail
				};
				await c.env.kv.put(`tg_session:${chatId}`, JSON.stringify(sessionObj), { expirationTtl: 600 });
				
				await answerCallback(callbackQueryId);
				await editTelegramMessage(messageId, `<b>发件人:</b> <code>${senderEmail}</code>\n\n请输入<b>收件人邮箱</b>：`);
				return;
			}

			if (callbackData === 'tg_cb:confirm_send') {
				const sessionStr = await c.env.kv.get(`tg_session:${chatId}`);
				if (!sessionStr) {
					await answerCallback(callbackQueryId);
					await editTelegramMessage(messageId, `⚠️ <b>会话已过期</b>\n请重新发送 /send 启动向导。`);
					return;
				}

				const session = JSON.parse(sessionStr);
				await answerCallback(callbackQueryId);
				await editTelegramMessage(messageId, `⚡️ <b>正在发送邮件，请稍候...</b>\n\n<b>收件人:</b> ${session.recipient}\n<b>主题:</b> ${session.subject}`);

				try {
					const emailService = (await import('./email-service')).default;
					const accountService = (await import('./account-service')).default;
					const userService = (await import('./user-service')).default;

					const adminUser = await userService.selectByEmailIncludeDel(c, c.env.admin);
					if (!adminUser) throw new Error('未配置系统管理员账户');

					const sendAccount = await accountService.selectByEmailIncludeDel(c, session.sender);
					if (!sendAccount) throw new Error(`找不到发信账号: ${session.sender}`);

					const sendParams = {
						accountId: sendAccount.accountId,
						name: sendAccount.name,
						sendType: 'send',
						receiveEmail: [session.recipient],
						text: session.body,
						content: session.body,
						subject: session.subject,
						attachments: []
					};

					await emailService.send(c, sendParams, adminUser.userId);
					await c.env.kv.delete(`tg_session:${chatId}`);
					await editTelegramMessage(messageId, `✅ <b>邮件发送成功！</b>\n\n<b>发件人:</b> ${session.sender}\n<b>收件人:</b> ${session.recipient}\n<b>主题:</b> ${session.subject}\n<b>正文:</b>\n${session.body}`);
				} catch (err) {
					await editTelegramMessage(messageId, `❌ <b>邮件发送失败:</b> ${err.message}\n\n可在重新检查后重新点击发送按钮。`, {
						inline_keyboard: [
							[
								{ text: '🔄 重试发送', callback_data: 'tg_cb:confirm_send' },
								{ text: '❌ 取消', callback_data: 'tg_cb:cancel_send' }
							]
						]
					});
				}
				return;
			}

			if (callbackData === 'tg_cb:cancel_send') {
				await c.env.kv.delete(`tg_session:${chatId}`);
				await answerCallback(callbackQueryId);
				await editTelegramMessage(messageId, `❌ <b>已取消邮件发送。</b>`);
				return;
			}
		}

		// 2. Process Session states (Text inputs)
		const sessionStr = await c.env.kv.get(`tg_session:${chatId}`);
		if (sessionStr && message && text) {
			const session = JSON.parse(sessionStr);

			if (session.step === 'recipient') {
				const recipientEmail = text.trim();
				if (!verifyUtils.isEmail(recipientEmail)) {
					await sendTelegramReply(`⚠️ <b>格式不正确</b>\n请重新输入正确的<b>收件人邮箱</b>：`);
					return;
				}

				session.recipient = recipientEmail;
				session.step = 'subject';
				await c.env.kv.put(`tg_session:${chatId}`, JSON.stringify(session), { expirationTtl: 600 });
				await sendTelegramReply(`<b>发件人:</b> <code>${session.sender}</code>\n<b>收件人:</b> <code>${session.recipient}</code>\n\n请输入<b>邮件主题</b>：`);
				return;
			}

			if (session.step === 'subject') {
				session.subject = text.trim();
				session.step = 'body';
				await c.env.kv.put(`tg_session:${chatId}`, JSON.stringify(session), { expirationTtl: 600 });
				await sendTelegramReply(`<b>发件人:</b> <code>${session.sender}</code>\n<b>收件人:</b> <code>${session.recipient}</code>\n<b>主题:</b> <code>${session.subject}</code>\n\n请输入<b>邮件内容 (正文)</b>：`);
				return;
			}

			if (session.step === 'body') {
				session.body = text.trim();
				session.step = 'confirm';
				await c.env.kv.put(`tg_session:${chatId}`, JSON.stringify(session), { expirationTtl: 600 });

				const summary = `✉️ <b>请确认你的邮件内容:</b>\n` +
					`---------------------------------\n` +
					`<b>发件人:</b> <code>${session.sender}</code>\n` +
					`<b>收件人:</b> <code>${session.recipient}</code>\n` +
					`<b>主题:</b> <code>${session.subject}</code>\n` +
					`<b>正文:</b>\n<code>${session.body}</code>\n` +
					`---------------------------------\n` +
					`确认发送吗？`;

				await sendTelegramReply(summary, {
					inline_keyboard: [
						[
							{ text: '✅ 确认发送', callback_data: 'tg_cb:confirm_send' },
							{ text: '❌ 取消', callback_data: 'tg_cb:cancel_send' }
						]
					]
				});
				return;
			}
		}

		// 3. Process Normal commands / texts
		if (message) {
			if (!text) {
				await sendTelegramReply(`⚠️ 目前仅支持回复文本消息！`);
				return;
			}

			if (text.startsWith('/start') || text.startsWith('/help')) {
				const helpMsg = `📧 <b>Cloud Mail Bot 使用帮助</b>\n\n` +
					`<b>1. 直接回复邮件</b>\n` +
					`当收到新邮件通知时，直接在该消息下使用 Telegram <b>回复 (Reply)</b> 功能，你的回复内容将自动以邮件形式发件给原发件人。\n\n` +
					`<b>2. 主动发送邮件 (交互向导 - 可选发信账户)</b>\n` +
					`输入 <code>/send</code> 命令即可开启引导式邮件发送向导。\n\n` +
					`<b>3. 主动发送邮件 (快捷命令行)</b>\n` +
					`格式：<code>/send &lt;收件人邮箱&gt; &lt;主题&gt; - &lt;邮件内容&gt;</code>\n` +
					`例如：<code>/send test@example.com 你好 - 这是来自 Telegram 的邮件</code>`;
				await sendTelegramReply(helpMsg);
				return;
			}

			if (text.startsWith('/send')) {
				const match = text.match(/^\/send\s+(\S+)\s+(.+?)\s+-\s+(.+)$/s);
				if (!match) {
					// Start interactive sending wizard
					try {
						const accountService = (await import('./account-service')).default;
						const userService = (await import('./user-service')).default;
						const { isDel: isDelVal } = await import('../const/entity-const');

						const adminUser = await userService.selectByEmailIncludeDel(c, c.env.admin);
						if (!adminUser) {
							throw new Error('未配置系统管理员账户');
						}

						const accounts = await orm(c).select().from((await import('../entity/account')).default).where(
							and(
								eq((await import('../entity/account')).default.userId, adminUser.userId),
								eq((await import('../entity/account')).default.isDel, isDelVal.NORMAL)
							)
						).all();

						if (!accounts || accounts.length === 0) {
							await sendTelegramReply(`❌ <b>发信失败:</b> 你尚未绑定任何发件邮箱，请先前往后台添加账号。`);
							return;
						}

						// Build keyboard buttons
						const keyboard = [];
						for (const acc of accounts) {
							keyboard.push([{ text: acc.email, callback_data: `tg_cb:sender:${acc.email}` }]);
						}

						// Set session
						const sessionObj = { step: 'sender' };
						await c.env.kv.put(`tg_session:${chatId}`, JSON.stringify(sessionObj), { expirationTtl: 600 });

						await sendTelegramReply(`📝 <b>新邮件发送向导</b>\n请选择发信人邮箱：`, {
							inline_keyboard: keyboard
						});
					} catch (err) {
						await sendTelegramReply(`❌ <b>向导启动失败:</b> ${err.message}`);
					}
					return;
				}

				// Handle quick send
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
					if (!adminUser) throw new Error('未配置系统管理员账户');

					const adminAccount = await accountService.selectByEmailIncludeDel(c, c.env.admin);
					const sendAccount = adminAccount || await accountService.selectFirstByUserId(c, adminUser.userId);
					if (!sendAccount) throw new Error('管理员未绑定任何发信邮箱账号');

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

			// Handle direct reply to notifications
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

}

export default telegramService;
