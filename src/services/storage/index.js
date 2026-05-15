import { env } from '../../utils/env.js';
import { LocalStorageAdapter } from './localStorageAdapter.js';

let adapter;

export function getStorage() {
  if (adapter) return adapter;
  adapter = new LocalStorageAdapter();
  return adapter;
}
