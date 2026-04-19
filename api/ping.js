module.exports = (req, res) => res.json({ ok: true, env_keys: Object.keys(process.env).filter(k => k.startsWith('TWILIO') || k.startsWith('ANTHROPIC') || k === 'PORT') });
