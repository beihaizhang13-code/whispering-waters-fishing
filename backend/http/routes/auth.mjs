/**
 * 《微风垂钓物语 2.0》账号认证与游客升级路由 (backend/http/routes/auth.mjs)
 */
import { readJsonBody } from '../middleware.mjs';
import { buildResponseHeaders, jsonError, jsonOk } from '../response.mjs';

function handleRouteError(err, ctx) {
  if (err && err.code) {
    return jsonError(
      err.code,
      err.message,
      err.details || null,
      err.status || null,
      ctx.requestId
    );
  }
  throw err;
}

function resolveRequestOrigin(req) {
  try {
    return new URL(req.url, 'http://localhost').origin;
  } catch {
    return '';
  }
}

async function resolveOAuthGuestUserId(ctx, services) {
  if (ctx.authUser && ctx.authUser.accountType === 'guest') {
    return ctx.authUser.id;
  }
  const guestToken = ctx.query.get('guestToken');
  if (typeof guestToken === 'string' && guestToken.trim() && services.auth?.resolveSessionUser) {
    const resolved = await services.auth.resolveSessionUser({
      scheme: 'guest',
      token: guestToken.trim()
    });
    if (resolved?.user?.accountType === 'guest') {
      return resolved.user.id;
    }
  }
  return null;
}

async function handleOAuthCallbackRoute(req, ctx, services, isPost) {
  try {
    const body = isPost ? await readJsonBody(req) : {};
    const code = isPost ? (body.code ?? ctx.query.get('code')) : ctx.query.get('code');
    const state = isPost ? (body.state ?? ctx.query.get('state')) : ctx.query.get('state');
    const oauthError = isPost ? (body.error ?? ctx.query.get('error')) : ctx.query.get('error');

    if (oauthError && !code) {
      const desc = isPost
        ? (body.error_description ?? ctx.query.get('error_description') ?? oauthError)
        : (ctx.query.get('error_description') || oauthError);
      return jsonError(
        'UNAUTHORIZED',
        `第三方授权未完成: ${desc}`,
        { provider: ctx.params.provider, oauthError },
        401,
        ctx.requestId
      );
    }

    const rawDeviceLabel = isPost ? body.deviceLabel : ctx.query.get('deviceLabel');
    const deviceLabel = typeof rawDeviceLabel === 'string' ? rawDeviceLabel.slice(0, 80) : null;

    const result = await services.auth.handleOAuthCallback({
      provider: ctx.params.provider,
      code,
      state,
      origin: resolveRequestOrigin(req),
      deviceLabel,
      ipHash: ctx.clientIpHash || null,
      userAgent: req.headers.get('user-agent') || null
    });
    return jsonOk(result, {}, 200, ctx.requestId);
  } catch (err) {
    return handleRouteError(err, ctx);
  }
}

export function createAuthRoutes({ services }) {
  return [
    {
      method: 'POST',
      path: '/api/v1/auth/guest',
      milestone: 'M1',
      authRequired: false,
      idempotent: false,
      async handler(req, ctx) {
        try {
          const body = await readJsonBody(req);
          const deviceLabel = typeof body.deviceLabel === 'string' ? body.deviceLabel.slice(0, 80) : null;
          const result = await services.auth.issueGuestSession({
            deviceLabel,
            ipHash: ctx.clientIpHash || null,
            userAgent: req.headers.get('user-agent') || null
          });
          return jsonOk(result, {}, 201, ctx.requestId);
        } catch (err) {
          return handleRouteError(err, ctx);
        }
      }
    },
    {
      method: 'POST',
      path: '/api/v1/auth/register',
      milestone: 'M1',
      authRequired: false,
      idempotent: false,
      async handler(req, ctx) {
        try {
          const body = await readJsonBody(req);
          const guestToken = body.guestToken
            || (ctx.authCreds?.scheme === 'guest' ? ctx.authCreds.token : null);
          const localSaveSnapshot = body.localSaveSnapshot ?? body.localSave ?? null;
          const result = await services.auth.registerWithEmail({
            email: body.email,
            password: body.password,
            displayName: body.displayName,
            guestToken,
            localSaveSnapshot,
            deviceLabel: typeof body.deviceLabel === 'string' ? body.deviceLabel.slice(0, 80) : null,
            ipHash: ctx.clientIpHash || null,
            userAgent: req.headers.get('user-agent') || null
          });
          return jsonOk(result, {}, 201, ctx.requestId);
        } catch (err) {
          return handleRouteError(err, ctx);
        }
      }
    },
    {
      method: 'POST',
      path: '/api/v1/auth/login',
      milestone: 'M1',
      authRequired: false,
      idempotent: false,
      async handler(req, ctx) {
        try {
          const body = await readJsonBody(req);
          const result = await services.auth.loginWithEmail({
            email: body.email,
            password: body.password,
            deviceLabel: typeof body.deviceLabel === 'string' ? body.deviceLabel.slice(0, 80) : null,
            ipHash: ctx.clientIpHash || null,
            userAgent: req.headers.get('user-agent') || null
          });
          return jsonOk(result, {}, 200, ctx.requestId);
        } catch (err) {
          return handleRouteError(err, ctx);
        }
      }
    },
    {
      method: 'POST',
      path: '/api/v1/auth/logout',
      milestone: 'M1',
      authRequired: true,
      idempotent: true,
      async handler(_req, ctx) {
        try {
          const result = await services.auth.revokeSession({
            sessionId: ctx.authSession?.id,
            userId: ctx.authUser.id
          });
          return jsonOk(result, {}, 200, ctx.requestId);
        } catch (err) {
          return handleRouteError(err, ctx);
        }
      }
    },
    {
      method: 'POST',
      path: '/api/v1/auth/upgrade',
      milestone: 'M1',
      authRequired: true,
      idempotent: false,
      async handler(req, ctx) {
        try {
          const body = await readJsonBody(req);
          const targetProvider = body.targetProvider || body.provider || 'email_password';
          const credentials = body.credentials || {
            email: body.email,
            password: body.password,
            displayName: body.displayName,
            mergeExisting: body.mergeExisting
          };
          const localSaveSnapshot = body.localSaveSnapshot ?? body.localSave ?? null;
          const result = await services.auth.upgradeGuestIdentity({
            guestUserId: ctx.authUser.id,
            targetProvider,
            credentials,
            localSaveSnapshot
          });
          return jsonOk(result, {}, 200, ctx.requestId);
        } catch (err) {
          return handleRouteError(err, ctx);
        }
      }
    },
    {
      method: 'GET',
      path: '/api/v1/auth/me',
      milestone: 'M1',
      authRequired: true,
      idempotent: true,
      async handler(_req, ctx) {
        try {
          const identities = await ctx.repositories.users.listIdentitiesByUserId(ctx.authUser.id);
          return jsonOk({
            user: ctx.authUser,
            session: ctx.authSession
              ? {
                  id: ctx.authSession.id,
                  deviceLabel: ctx.authSession.deviceLabel,
                  expiresAt: ctx.authSession.expiresAt,
                  lastSeenAt: ctx.authSession.lastSeenAt
                }
              : null,
            identities
          }, {}, 200, ctx.requestId);
        } catch (err) {
          return handleRouteError(err, ctx);
        }
      }
    },
    {
      method: 'DELETE',
      path: '/api/v1/auth/account',
      milestone: 'M1',
      authRequired: true,
      idempotent: true,
      async handler(req, ctx) {
        try {
          const body = await readJsonBody(req);
          const confirmText = body.confirmText ?? ctx.query.get('confirmText') ?? '';
          const result = await services.auth.deleteAccount({
            userId: ctx.authUser.id,
            confirmText
          });
          return jsonOk(result, {}, 200, ctx.requestId);
        } catch (err) {
          return handleRouteError(err, ctx);
        }
      }
    },
    {
      method: 'GET',
      path: '/api/v1/auth/oauth/:provider',
      milestone: 'M1',
      authRequired: false,
      idempotent: true,
      async handler(req, ctx) {
        try {
          const guestUserId = await resolveOAuthGuestUserId(ctx, services);
          const redirectAfter = ctx.query.get('redirectAfter') || null;
          const data = await services.auth.buildOAuthAuthorizationUrl({
            provider: ctx.params.provider,
            origin: resolveRequestOrigin(req),
            guestUserId,
            redirectAfter
          });

          const mode = (ctx.query.get('mode') || '').trim().toLowerCase();
          const format = (ctx.query.get('format') || '').trim().toLowerCase();
          if (mode === 'json' || format === 'json') {
            return jsonOk(data, {}, 200, ctx.requestId);
          }

          return new Response(null, {
            status: 302,
            headers: buildResponseHeaders(ctx.requestId, {
              Location: data.authorizeUrl
            })
          });
        } catch (err) {
          return handleRouteError(err, ctx);
        }
      }
    },
    {
      method: 'GET',
      path: '/api/v1/auth/oauth/:provider/callback',
      milestone: 'M1',
      authRequired: false,
      idempotent: false,
      async handler(req, ctx) {
        return handleOAuthCallbackRoute(req, ctx, services, false);
      }
    },
    {
      method: 'POST',
      path: '/api/v1/auth/oauth/:provider/callback',
      milestone: 'M1',
      authRequired: false,
      idempotent: false,
      async handler(req, ctx) {
        return handleOAuthCallbackRoute(req, ctx, services, true);
      }
    }
  ];
}
