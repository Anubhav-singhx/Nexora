// Mock core-banking API. NOT for browsers: it needs the service key (x-api-key), which only the backend knows.
import { Router } from 'express';
import { handleOpenAccount } from '../services/coreBanking/mockService.js';

const router = Router();
router.post('/accounts', (req, res) => {
  const { status, body } = handleOpenAccount({ apiKey: req.get('x-api-key'), body: req.body });
  res.status(status).json(body);
});
export default router;
