import { Router } from 'express';
import { authenticateUser } from '../middlewares/authMiddleware.js';
import { createQuestion, createQuestionReply, listQuestions, listReplies, patchQuestion, removeQuestion, removeReply } from '../controllers/courseQaController.js';
import { createComment, listComments, removeComment } from '../controllers/lessonCommentsController.js';

const router = Router();

// Course Q&A (enrollment-protected)
router.get('/courses/:courseId/questions', authenticateUser, listQuestions);
router.post('/courses/:courseId/questions', authenticateUser, createQuestion);
router.patch('/questions/:id', authenticateUser, patchQuestion);
router.delete('/questions/:id', authenticateUser, removeQuestion);
router.get('/questions/:id/replies', authenticateUser, listReplies);
router.post('/questions/:id/replies', authenticateUser, createQuestionReply);
router.delete('/replies/:id', authenticateUser, removeReply);

// Lesson comments (enrollment-protected)
router.get('/lessons/:lessonId/comments', authenticateUser, listComments);
router.post('/lessons/:lessonId/comments', authenticateUser, createComment);
router.delete('/comments/:id', authenticateUser, removeComment);

export default router;

