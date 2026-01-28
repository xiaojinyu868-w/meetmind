import { redirect } from 'next/navigation';

/**
 * 根路由 - 重定向到登录页
 */
export default function RootPage() {
  redirect('/login');
}
