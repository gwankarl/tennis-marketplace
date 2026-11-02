import 'dotenv/config';
import { parseBackendEnv } from './env.js';

export const env = parseBackendEnv(process.env);
