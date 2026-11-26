/**
 * 《微风垂钓物语 2.0》前后端单一事实源：统一错误码定义 (shared/error_codes.js)
 * ----------------------------------------------------------------------------
 * 所有后端 HTTP API 错误响应均使用此处声明的稳定 code，便于前端 ApiClient 精确分支处理。
 */
(function (root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }
  const target = root || (typeof globalThis !== 'undefined' ? globalThis : {});
  target.WWF_SHARED = target.WWF_SHARED || {};
  target.WWF_SHARED.ErrorCodes = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ERROR_CODES = Object.freeze({
    OK: { code: 'OK', httpStatus: 200, message: '请求成功' },
    VALIDATION_ERROR: { code: 'VALIDATION_ERROR', httpStatus: 400, message: '请求参数或存档格式校验失败' },
    UNAUTHORIZED: { code: 'UNAUTHORIZED', httpStatus: 401, message: '未登录或会话凭证已失效' },
    FORBIDDEN: { code: 'FORBIDDEN', httpStatus: 403, message: '无权限执行此操作或来源校验未通过' },
    NOT_FOUND: { code: 'NOT_FOUND', httpStatus: 404, message: '请求的资源不存在' },
    METHOD_NOT_ALLOWED: { code: 'METHOD_NOT_ALLOWED', httpStatus: 405, message: '当前路由不支持该 HTTP 方法' },
    SAVE_CONFLICT: { code: 'SAVE_CONFLICT', httpStatus: 409, message: '云端存档版本已更新，请先拉取合并后再覆盖' },
    IDEMPOTENCY_CONFLICT: { code: 'IDEMPOTENCY_CONFLICT', httpStatus: 409, message: '重复的幂等操作键或参数不一致' },
    ANTICHEAT_REJECTED: { code: 'ANTICHEAT_REJECTED', httpStatus: 422, message: '操作未通过服务端合理性及经济校验' },
    RATE_LIMITED: { code: 'RATE_LIMITED', httpStatus: 429, message: '请求过于频繁，请稍后再试' },
    INTERNAL_ERROR: { code: 'INTERNAL_ERROR', httpStatus: 500, message: '服务端发生未预期异常' },
    NOT_IMPLEMENTED: { code: 'NOT_IMPLEMENTED', httpStatus: 501, message: '该接口契约已就绪，业务实现将在后续里程碑完成' },
    SERVICE_UNAVAILABLE: { code: 'SERVICE_UNAVAILABLE', httpStatus: 503, message: '依赖存储服务暂未就绪，请稍后重试' }
  });

  function getErrorDef(code) {
    return ERROR_CODES[code] || ERROR_CODES.INTERNAL_ERROR;
  }

  return {
    ERROR_CODES,
    getErrorDef
  };
});
