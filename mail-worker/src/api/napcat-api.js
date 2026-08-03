import app from '../hono/hono';
import { and, asc, eq, gt, ne } from 'drizzle-orm';
import email from '../entity/email';
import { emailConst, isDel } from '../const/entity-const';
import orm from '../entity/orm';

const BATCH_SIZE = 10;

app.get('/napcat/poll', async (c) => {
	const expectedSecret = c.env.NAPCAT_POLL_SECRET;
	const providedSecret = c.req.header('X-NapCat-Secret');
	if (!expectedSecret || providedSecret !== expectedSecret) {
		return c.json({ code: 401, message: 'Unauthorized' }, 401);
	}

	const parsedCursor = Number(c.req.query('after') || 0);
	const cursor = Number.isSafeInteger(parsedCursor) && parsedCursor >= 0 ? parsedCursor : 0;

	const emails = await orm(c).select({
		emailId: email.emailId,
		sendEmail: email.sendEmail,
		name: email.name,
		toEmail: email.toEmail,
		subject: email.subject,
		text: email.text,
		content: email.content,
		createTime: email.createTime
	}).from(email).where(and(
		gt(email.emailId, cursor),
		eq(email.type, emailConst.type.RECEIVE),
		eq(email.isDel, isDel.NORMAL),
		ne(email.status, emailConst.status.SAVING)
	)).orderBy(asc(email.emailId)).limit(BATCH_SIZE);

	return c.json({
		code: 200,
		data: {
			emails,
		nextCursor: emails.length > 0 ? emails[emails.length - 1].emailId : cursor
		}
	});
});
