import { Router } from 'express';
import {
  getAboutContent,
  getHomepageContent,
  getLegalPage,
  getSeoMeta,
  listPublicAnnouncements,
  listPublicFaqs,
  listPublicGallery,
  listPublicTestimonials,
} from '../controllers/cmsPublicController.js';
import { subscribe } from '../controllers/newsletterController.js';

const router = Router();

router.get('/content/homepage', getHomepageContent);
router.get('/content/about', getAboutContent);
router.get('/testimonials', listPublicTestimonials);
router.get('/faqs', listPublicFaqs);
router.get('/announcements', listPublicAnnouncements);
router.get('/gallery', listPublicGallery);
router.get('/legal/:slug', getLegalPage);
router.get('/seo/:page', getSeoMeta);
router.post('/newsletter/subscribe', subscribe);

export default router;

