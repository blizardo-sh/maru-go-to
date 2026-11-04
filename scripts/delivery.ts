// Public runtime files and release sources use separate, explicit filters.
export function publicRuntimeFile(path: string) {
  return !/(^|\/)(selfcheck\.[^/]+|[^/]*generation[^/]*|[^/]*-source\.json)$/.test(path);
}
export function releaseSourceFile(path: string) {
  return !/(^|\/)(selfcheck\.[^/]+|[^/]*generation-report\.json)$/.test(path) && !path.startsWith('materials/examples/');
}
