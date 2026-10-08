import { readFile } from 'node:fs';
import { createElement } from 'react';

export { basename } from 'node:path';
export { createRoot } from 'react-dom/client';
export const runtime = [readFile, createElement];
