export const roles = ['admin', 'leader', 'author', 'questionReviewer', 'composer', 'paperReviewer'] as const;
export type Role = typeof roles[number];
const prefix: Record<Role, string> = {
  admin: 'ADMIN', leader: 'LEADER', author: 'AUTHOR', questionReviewer: 'QUESTION_REVIEWER',
  composer: 'COMPOSER', paperReviewer: 'PAPER_REVIEWER',
};
export interface Credentials { username: string; password: string }
export interface BmtkConfig {
  baseURL: string;
  tenantName: string;
  accounts: Record<Role, Credentials>;
  pdfPython: string;
}

// 调用时才校验；--list 不需要真实账号，执行用例则不能静默 skip。
export function loadBmtkConfig(env: NodeJS.ProcessEnv = process.env): BmtkConfig {
  const required = (key: string) => {
    const value = env[key];
    if (!value?.trim()) throw new Error(`缺少 ${key}，请按 .env.example 配置本机专用测试账号`);
    return value;
  };
  if (env.BMTK_ALLOW_WRITES !== '1') throw new Error('测试会创建并保留业务数据；执行前需设置 BMTK_ALLOW_WRITES=1');
  const baseURL = new URL(required('BMTK_BASE_URL'));
  if (!['http:', 'https:'].includes(baseURL.protocol) || baseURL.username || baseURL.password)
    throw new Error('BMTK_BASE_URL 必须是无凭据的 HTTP(S) 地址');
  if (baseURL.pathname !== '/' || baseURL.search || baseURL.hash)
    throw new Error('BMTK_BASE_URL 只填写站点根地址');
  const accounts = Object.fromEntries(roles.map(role => [role, {
    username: required(`BMTK_${prefix[role]}_USERNAME`), password: required(`BMTK_${prefix[role]}_PASSWORD`),
  }])) as Record<Role, Credentials>;
  if (new Set(Object.values(accounts).map(a => a.username)).size !== roles.length)
    throw new Error('六个角色必须使用各自独立的测试账号，避免登录互踢');
  return {
    baseURL: baseURL.origin, tenantName: required('BMTK_TENANT_NAME'), accounts,
    pdfPython: env.BMTK_PDF_PYTHON || 'python3'
  };
}
