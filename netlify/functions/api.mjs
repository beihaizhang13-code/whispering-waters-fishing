/**
 * 《微风垂钓物语 2.0》Netlify Functions v2 统一 API 网关入口 (netlify/functions/api.mjs)
 * ----------------------------------------------------------------------------
 * 说明：
 * - 不静态导入尚未安装的 @netlify/functions / @netlify/database，保持零依赖可打包；
 * - 复用平台无关的 backend/http/router.mjs，与本地 server.js 保持 100% 一致的路由与契约。
 */
import { createApiHandler } from '../../backend/http/router.mjs';

let cachedHandler = null;

function getHandler() {
  if (!cachedHandler) {
    cachedHandler = createApiHandler();
  }
  return cachedHandler;
}

export default async function handler(req, context) {
  return getHandler().handleRequest(req, context || {});
}

export const config = {
  path: '/api/*'
};
