import { mkdirSync } from 'node:fs';

export const output = `${import.meta.dir}/../../test-results`;
mkdirSync(output, { recursive: true });
