import { bumpNamespace } from './cacheService.js';

export async function invalidatePublicCourses() {
  await bumpNamespace('public_courses');
  await bumpNamespace('public_course_detail');
  await bumpNamespace('search_suggestions');
}

export async function invalidatePublicRecipes() {
  await bumpNamespace('public_recipes');
  await bumpNamespace('public_recipe_detail');
  await bumpNamespace('search_suggestions');
}

export async function invalidateCategories() {
  await bumpNamespace('public_categories');
  await bumpNamespace('search_suggestions');
}

