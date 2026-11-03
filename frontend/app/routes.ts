import {
  index,
  layout,
  route,
  type RouteConfig,
} from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('register', 'routes/register.tsx'),
  route('verify-email', 'routes/verify-email.tsx'),
  route('resend-verification', 'routes/resend-verification.tsx'),
  route('login', 'routes/login.tsx'),
  layout('routes/workspace-layout.tsx', [
    route('account', 'routes/account.tsx'),
    route('profile', 'routes/profile.tsx'),
    route('seller', 'routes/seller.tsx'),
    route('admin', 'routes/admin.tsx'),
  ]),
] satisfies RouteConfig;
