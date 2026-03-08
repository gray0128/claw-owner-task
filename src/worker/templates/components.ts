/**
 * 错误页面组件。
 * 用于所有公开路由的错误/过期/不存在提示。
 */
export function errorPageHtml(title: string, message: string): string {
  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <style>
        :root { --bg: #fafafa; --surface: #ffffff; --text: #171717; --text-muted: #737373; --border: #e5e5e5; }
        body { font-family: "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: var(--bg); color: var(--text); height: 100vh; margin: 0; display: flex; align-items: center; justify-content: center; -webkit-font-smoothing: antialiased; }
        .card { background: var(--surface); padding: 40px; border-radius: 12px; box-shadow: 0 4px 24px -8px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0,0,0,0.02); border: 1px solid var(--border); text-align: center; max-width: 400px; width: 100%; margin: 20px; }
        h1 { color: #dc2626; margin: 0 0 12px 0; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
        p { color: var(--text-muted); line-height: 1.6; margin: 0 0 24px 0; font-size: 15px; }
        .brand { font-size: 12px; font-weight: 600; color: #d4d4d4; letter-spacing: 0.05em; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>${title}</h1>
        <p>${message}</p>
        <div class="brand">CLAW TASK</div>
      </div>
    </body>
    </html>
  `;
}

/** 页脚品牌标记 */
export const FOOTER_BRAND = `<div class="brand">Claw Task</div>`;
