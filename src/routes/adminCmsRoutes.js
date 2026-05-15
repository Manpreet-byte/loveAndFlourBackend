import { Router } from 'express';
import {
  adminGetAbout,
  adminGetHomepage,
  adminCreateFaq,
  adminCreateGallery,
  adminCreateTestimonial,
  adminDeleteFaq,
  adminDeleteGallery,
  adminDeleteTestimonial,
  adminListAnnouncements,
  adminListFaqs,
  adminListGallery,
  adminListNewsletterSubscribers,
  adminListTestimonials,
  adminPatchAnnouncements,
  adminPatchLegal,
  adminPatchSeo,
  adminUpdateFaq,
  adminUpdateTestimonial,
  patchAbout,
  patchHomepage,
} from '../controllers/adminCmsController.js';

const router = Router();

// Content pages
router.get('/content/homepage', adminGetHomepage);
router.patch('/content/homepage', patchHomepage);
router.get('/content/about', adminGetAbout);
router.patch('/content/about', patchAbout);

// Testimonials
router.get('/testimonials', adminListTestimonials);
router.post('/testimonials', adminCreateTestimonial);
router.patch('/testimonials/:id', adminUpdateTestimonial);
router.delete('/testimonials/:id', adminDeleteTestimonial);

// FAQs
router.get('/faqs', adminListFaqs);
router.post('/faqs', adminCreateFaq);
router.patch('/faqs/:id', adminUpdateFaq);
router.delete('/faqs/:id', adminDeleteFaq);

// Announcements (campaign entries)
router.get('/announcements', adminListAnnouncements);
router.patch('/announcements', adminPatchAnnouncements);

// Legal pages
router.patch('/legal/:slug', adminPatchLegal);

// SEO
router.patch('/seo/:page', adminPatchSeo);

// Student gallery
router.get('/gallery', adminListGallery);
router.post('/gallery', adminCreateGallery);
router.delete('/gallery/:id', adminDeleteGallery);

// Newsletter subscribers
router.get('/newsletter/subscribers', adminListNewsletterSubscribers);

export default router;
