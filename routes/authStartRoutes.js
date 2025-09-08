import express from 'express';

const router = express.Router();

function redirect(target) {
  return (req, res) => {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(302, `${target}${qs}`);
  };
}

router.get('/twitter/start', redirect('/auth/twitter'));
router.get('/telegram/start', redirect('/auth/telegram/start'));
router.get('/discord/start', redirect('/auth/discord'));

export default router;
