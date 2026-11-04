export function disposableDatabase(target: URL) {
  return ['localhost', '127.0.0.1'].includes(target.hostname) && (target.pathname === '/japanese_app_test' || (target.port === '55440' && /^\/japanese_pixi_m8_units_\d+$/.test(target.pathname)));
}
