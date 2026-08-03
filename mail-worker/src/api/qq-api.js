import app from '../hono/hono';

const GROUP_OPENID_KEY = 'qq:official:group-openid';

async function signValidation(secret, eventTs, plainToken) {
	const seedText = secret.repeat(Math.ceil(32 / secret.length)).slice(0, 32);
	const privateKey = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(seedText),
		{ name: 'Ed25519' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign(
		'Ed25519',
		privateKey,
		new TextEncoder().encode(eventTs + plainToken)
	);
	return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}

app.post('/qq/webhook', async (c) => {
	const body = await c.req.json();

	if (body.op === 13 && body.d?.plain_token && body.d?.event_ts) {
		const secret = c.env.QQ_BOT_APP_SECRET;
		if (!secret) return c.json({ message: 'QQ bot secret is not configured' }, 500);

		return c.json({
			plain_token: body.d.plain_token,
			signature: await signValidation(secret, body.d.event_ts, body.d.plain_token)
		});
	}

	if (body.d?.group_openid) {
		await c.env.kv.put(GROUP_OPENID_KEY, body.d.group_openid);
		console.log(`已记录 QQ group_openid: ${body.d.group_openid}`);
	}

	return c.json({});
});
