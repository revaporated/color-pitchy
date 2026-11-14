// Lets Node run the app's TypeScript directly (with --experimental-strip-types):
// src/ imports omit the .ts extension, as Vite allows, so this adds it.
import { register } from 'node:module';

register('./ts-resolve-hooks.mjs', import.meta.url);
