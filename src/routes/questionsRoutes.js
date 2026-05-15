import { Router } from 'express';
import { authenticateUser } from '../middlewares/authMiddleware.js';
import {
  createQuestion,
  getQuestion,
  listQuestionsByCourse,
  patchQuestion,
  patchQuestionStatus,
  postReply,
  removeQuestion,
} from '../controllers/questionsController.js';

const router = Router();

router.use(authenticateUser);

router.get('/course/:courseId', listQuestionsByCourse);
router.post('/', createQuestion);
router.get('/:id', getQuestion);
router.post('/:id/replies', postReply);
router.patch('/:id', patchQuestion);
router.delete('/:id', removeQuestion);
router.patch('/:id/status', patchQuestionStatus);

export default router;

