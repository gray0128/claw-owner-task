/**
 * 全局 CSS 变量和基础样式。
 * 所有公开页面（summary、share、list）共享此样式集合。
 */
export const BASE_CSS_VARS = `
  :root {
    --primary: #7c3aed;
    --primary-light: #a78bfa;
    --primary-dark: #5b21b6;
    --bg: #f5f3ff;
    --surface: #ffffff;
    --text: #1e1b4b;
    --text-muted: #6b7280;
    --border: #e5e7eb;
    --radius: 16px;
    --green: #10b981;
    --amber: #f59e0b;
    --red: #ef4444;
    --blue: #3b82f6;
  }
`;

export const BASE_STYLES = `
  * { box-sizing: border-box; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background-color: var(--bg);
    color: var(--text);
    line-height: 1.6;
    margin: 0;
    padding: 0;
    -webkit-font-smoothing: antialiased;
  }
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;

export const GOOGLE_FONTS_LINK = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
`;

/** 生成 Material Symbols 的 link 标签，按需指定 icon_names */
export function materialIconsLink(iconNames: string[]): string {
  return `<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&icon_names=${iconNames.join(',')}" rel="stylesheet">`;
}
