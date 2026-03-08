#!/usr/bin/env bash
set -euo pipefail

echo ""
echo -e "\033[1;33m[!] 正在移除旧版/损坏的 Volcengine ASR Plugin...\033[0m"

OPENCLAW_DIR="${OPENCLAW_DIR:-$HOME/.openclaw}"
SKILL_DIR="$OPENCLAW_DIR/skills/volcengine-asr"
PLUGINS_SOURCE_DIR="$OPENCLAW_DIR/plugins-source/volcengine-asr"
EXTENSIONS_DIR="$OPENCLAW_DIR/extensions/volcengine-asr"
CONFIG_FILE="$OPENCLAW_DIR/openclaw.json"

for DIR in "$SKILL_DIR" "$PLUGINS_SOURCE_DIR" "$EXTENSIONS_DIR"; do
    if [ -d "$DIR" ]; then
        rm -rf "$DIR"
        echo -e "  \033[0;32m[OK]\033[0m 已删除目录: $DIR"
    fi
done

if [ -f "$CONFIG_FILE" ]; then
    if command -v node &> /dev/null; then
        node -e "
const fs = require('fs');
const file = '$CONFIG_FILE';
try {
  let config = JSON.parse(fs.readFileSync(file, 'utf8'));
  let modified = false;
  
  if (config.skills && config.skills.entries && config.skills.entries['volcengine-asr']) {
    delete config.skills.entries['volcengine-asr'];
    modified = true;
  }
  
  if (config.plugins && config.plugins.entries && config.plugins.entries['volcengine-asr']) {
    delete config.plugins.entries['volcengine-asr'];
    modified = true;
  }
  
  if (modified) {
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
    console.log('  \033[0;32m[OK]\033[0m 已从 openclaw.json 中彻底移除 volcengine-asr 配置');
  } else {
    console.log('  \033[0;34m[i]\033[0m openclaw.json 中没有找到相关配置');
  }
} catch(e) {
  console.error('  \033[0;31m[X]\033[0m 处理 JSON 失败: ' + e.message);
}
"
    else
        echo -e "  \033[0;31m[X]\033[0m 未找到 Node.js，请手动编辑该文件并移除配置"
    fi
else
    echo -e "  \033[0;34m[i]\033[0m 配置文件不存在: $CONFIG_FILE"
fi

echo ""
echo -e "\033[1;32m残留已强制清理完毕！如果 OpenClaw 服务还在运行，请稍后执行 openclaw gateway restart 重启。\033[0m"
echo ""
