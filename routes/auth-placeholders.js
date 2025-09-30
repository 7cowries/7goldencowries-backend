export default function registerAuthPlaceholders(app) {
  app.get('/auth/telegram/start', (req, res) => {
    return res.status(501).json({ ok:false, message: "Telegram auth not implemented (placeholder)" });
  });

  app.get('/auth/twitter/start', (req, res) => {
    return res.status(501).json({ ok:false, message: "Twitter auth not implemented (placeholder)" });
  });
}
