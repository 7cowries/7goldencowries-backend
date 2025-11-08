import { Router } from 'express';
const router = Router();
router.get('/', (_req, res) => res.redirect(307, '/api/quests'));
export default router;
